import Decimal from "decimal.js";
import {setTimeout as sleep} from "node:timers/promises";
import {z} from "zod";

const billingResponse=z.object({
  code:z.literal(200),
  data:z.object({
    has_more:z.boolean(),
    items:z.array(z.object({
      uuid:z.string().min(1),
      billing_type:z.literal("deduct"),
      price:z.number().finite().nonnegative(),
      prediction:z.object({uuid:z.string()})
    }))
  })
});

type PendingReason="permission"|"not_visible"|"unavailable"|"unexpected_response";
type BillingResult={status:"confirmed";chargedUsd:string;recordCount:number}|
  {status:"pending";reason:PendingReason};

export async function readPredictionBilling(apiKey:string,predictionId:string):Promise<BillingResult> {
  let reason:PendingReason="not_visible";
  for(const delay of [0,2000,5000,10000]){
    if(delay)await sleep(delay);
    try{
      // This POST searches billing history. It never creates a prediction.
      const response=await fetch("https://api.wavespeed.ai/api/v3/billings/search",{
        method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({prediction_uuids:[predictionId],billing_type:"deduct",page:1,page_size:100}),
        signal:AbortSignal.timeout(5000),cache:"no-store",redirect:"error"
      });
      if(response.status===401||response.status===403)return {status:"pending",reason:"permission"};
      if(!response.ok){reason="unavailable";continue;}
      const raw=await response.json();
      if(raw?.code===401||raw?.code===403)return {status:"pending",reason:"permission"};
      const result=billingResponse.safeParse(raw);
      if(!result.success)return {status:"pending",reason:"unexpected_response"};
      const {items,has_more}=result.data.data;
      if(has_more||items.some(item=>item.prediction.uuid!==predictionId)||
        new Set(items.map(item=>item.uuid)).size!==items.length)
        return {status:"pending",reason:"unexpected_response"};
      if(items.length===0){reason="not_visible";continue;}
      const charged=items.reduce((total,item)=>total.plus(item.price),new Decimal(0));
      return {status:"confirmed",chargedUsd:charged.toString(),recordCount:items.length};
    }catch{
      // The query is read-only. Retry transient errors within the bounded window.
      reason="unavailable";
    }
  }
  return {status:"pending",reason};
}
