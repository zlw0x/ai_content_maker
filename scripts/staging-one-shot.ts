/**
 * Operator-only E2E: one cheapest WaveSpeed image through our real Next.js app.
 * Requires a fresh, private API key on an isolated staging deployment.
 *
 * Does not run in CI. Never retry a submission POST after an ambiguous failure.
 */
import {randomBytes,randomUUID} from "node:crypto";
import Decimal from "decimal.js";
import {config} from "../src/server/config";
import {db,transaction} from "../src/server/db";
import {creditConfirmedPayment} from "../src/server/wallet";
import {providerPrice,providerBalance} from "../src/server/wavespeed";
import {readPredictionBilling} from "./wavespeed-billing";

const MODEL="wavespeed-ai/z-image/turbo";
const PROMPT="A miniature red electric scooter on a white studio background, photorealistic product photography";
const INPUT={prompt:PROMPT,size:"1024*1024",output_format:"jpeg"};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function reportProviderBilling(jobId:string,userId:string,apiKey:string,providerCap:number):Promise<void> {
  const result=await db().query<{provider_prediction_id:string|null;provider_cost_usd:string}>(
    `SELECT j.provider_prediction_id,q.provider_cost_usd
      FROM generation_jobs j JOIN price_quotes q ON q.id=j.quote_id
      WHERE j.id=$1 AND j.user_id=$2 AND j.provider='wavespeed'`,
    [jobId,userId]
  ).catch(()=>null);
  const job=result?.rows[0];
  if(!job?.provider_prediction_id){
    console.log("WAVESPEED_BILLING",{jobId,status:"pending",reason:"prediction_id_unavailable"});
    return;
  }
  const predictionId=job.provider_prediction_id;
  const billing=await readPredictionBilling(apiKey,predictionId);
  const charged=billing.status==="confirmed"?new Decimal(billing.chargedUsd):null;
  console.log("WAVESPEED_BILLING",{
    jobId,predictionId,orderQuotedUsd:new Decimal(job.provider_cost_usd).toString(),...billing,
    ...(charged?{matchesOrderQuote:charged.eq(job.provider_cost_usd),withinStageCap:charged.lte(providerCap)}:{})
  });
}

async function main(){
  const c=config();
  const args=process.argv.slice(2);
  const redacted=args[1]==="--redacted-report";
  if(args[0]!=="--allow-one-paid-inference"||args.length>(redacted?2:1))
    throw new Error("Run with --allow-one-paid-inference to authorize exactly one paid task.");
  if(c.WAVESPEED_MODE!=="live"||c.PAYMENT_MODE!=="disabled"||
    c.DEMO_CREDIT_ENABLED!=="false"||c.STAGING_MANUAL_CREDIT_ENABLED!=="true"||
    c.ALLOW_LIVE_PAYMENTS!=="false"||!c.WAVESPEED_API_KEY)
    throw new Error("Requires isolated live staging with disabled payments and explicit staging credit.");
  if(c.WORKER_CONCURRENCY!==1||c.MAX_PROVIDER_COST_USD>0.01||
    c.MAX_ORDER_KOPECKS>1500||c.MAX_DAILY_SPEND_KOPECKS>1500)
    throw new Error("Set WORKER_CONCURRENCY=1, MAX_PROVIDER_COST_USD<=0.01 and RUB caps<=1500.");
  if(!c.OUTPUT_HOST_ALLOWLIST.trim())throw new Error("Set verified OUTPUT_HOST_ALLOWLIST before spending.");
  const target=new URL(process.env.STAGING_WEB_INTERNAL_URL??"http://web:3000");
  if(target.protocol!=="http:"||!["web","localhost","127.0.0.1"].includes(target.hostname)||
    target.pathname!=="/"||target.search||target.hash)
    throw new Error("Use local app service (http://web:3000) for staging API.");
  const url=target.origin;

  const status=await db().query<{accounts:string;demo:string}>(
    "SELECT (SELECT count(*) FROM users)::text AS accounts, " +
    "(SELECT count(*) FROM payments WHERE provider='dev')::text AS demo"
  );
  if(Number(status.rows[0].accounts)!==0||Number(status.rows[0].demo)!==0)
    throw new Error("Not a clean staging database. Refusing paid experiment.");

  const providerCost=new Decimal(await providerPrice(MODEL,INPUT));
  const balance=new Decimal(await providerBalance());
  if(providerCost.lt(0)||providerCost.gt("0.01")||balance.lt(providerCost))
    throw new Error("Price exceeds $0.01 or provider balance insufficient.");
  console.log("Price verified; no paid request submitted yet",{
    model:MODEL,priceUsd:providerCost.toString(),balanceEnough:true
  });

  let cookie="";
  async function api(path:string,method:"GET"|"POST",payload?:object,key?:string){
    const result=await fetch(url+"/api/v1"+path,{
      method,headers:{
        Origin:c.APP_ORIGIN,
        ...(payload?{"Content-Type":"application/json"}:{}),
        ...(cookie?{Cookie:cookie}:{}),
        ...(key?{"Idempotency-Key":key}:{})
      },
      body:payload?JSON.stringify(payload):undefined,
      cache:"no-store",redirect:"error",signal:AbortSignal.timeout(30000)
    });
    const body=await result.json().catch(()=>null) as Record<string,any>|null;
    if(!result.ok)throw new Error("App API "+method+" "+path+" -> HTTP "+result.status+
      (redacted?"":" "+JSON.stringify(body)));
    return {response:result,body:body??{}};
  }
  const email="staging-"+randomUUID()+"@example.invalid";
  const password="Staging-"+randomBytes(24).toString("base64url")+"!";
  const signup=await api("/auth/register","POST",{email,password});
  const userId=String(signup.body.user?.id??"");
  cookie=signup.response.headers.get("set-cookie")?.split(";")[0]??"";
  if(!userId||!cookie.startsWith("acm_session="))throw new Error("Registration session not created.");

  if(!redacted)console.log("Staging account (private operator console only)",{
    email,temporaryPassword:password
  });
  const quote=await api("/quotes","POST",{
    appSlug:"text-to-image",input:{prompt:PROMPT,size:"1024*1024"}
  });
  const quoteId=String(quote.body.id??"");
  const amount=Number(quote.body.amountKopecks);
  if(!quoteId||!Number.isSafeInteger(amount)||amount<1||amount>1000)
    throw new Error("Server quote unavailable or exceeds staging budget (1000 kopecks).");
  const paymentId=randomUUID();
  await transaction(async client=>{
    await client.query(
      "INSERT INTO payments(id,user_id,client_idempotency_key,amount_kopecks,status,provider,external_payment_id) "+
      "VALUES($1,$2,$3,$4,'succeeded','staging',$5)",
      [paymentId,userId,paymentId,amount,"staging-"+paymentId]
    );
    await creditConfirmedPayment(client,paymentId,userId,amount);
  });
  console.log("Funding and quote",{
    quoteId,internalCreditKopecks:amount,
    operatorPaidInferenceAuthorization:true
  });

  // Exactly one user order POST. If its response is missing, STOP; do not retry.
  let jobId:string;
  try{
    const result=await api("/orders","POST",{quoteId},randomUUID());
    jobId=String(result.body.id??"");
  }catch(e){
    console.error("Uncertain paid request. Inspect DB/provider history; never submit again.");
    throw e;
  }
  if(!jobId)throw new Error("Missing job ID; do not submit another order.");
  console.log("Order submitted ONCE:",jobId);

  try{
    for(let attempt=0;attempt<90;attempt++){
      const result=await api("/orders/"+jobId,"GET");
      const job=result.body;
      if(job.status==="completed"){
        const outputs=job.outputs as Array<{id:string;url:string;mediaType:string}>|undefined;
        if(!outputs?.length)throw new Error("Completed job has no private output.");
        for(const output of outputs){
          if(!/^\/api\/v1\/assets\/[a-f0-9-]+$/i.test(output.url))
            throw new Error("Expected a private app asset URL.");
          const file=await fetch(url+output.url,{
            headers:{Cookie:cookie},redirect:"error",signal:AbortSignal.timeout(60000)
          });
          if(!file.ok)throw new Error("Private download HTTP "+file.status);
          const type=file.headers.get("content-type")??"";
          if(!["image/png","image/jpeg","image/webp"].includes(type))
            throw new Error("Unexpected output type "+type);
          const size=(await file.arrayBuffer()).byteLength;
          if(size<500)throw new Error("Output image unexpectedly small.");
          if(redacted){
            const anonymous=await fetch(url+output.url,{
              redirect:"error",signal:AbortSignal.timeout(10000)
            });
            await anonymous.body?.cancel();
            if(anonymous.status!==401)throw new Error("Expected HTTP 401 for unauthenticated asset read, got "+anonymous.status);
          }
          console.log("Private result downloaded",{
            assetId:output.id,mediaType:type,bytes:size,...(redacted?{anonymousReadStatus:401}:{})
          });
        }
        const wallet=(await api("/wallet","GET")).body;
        if(redacted&&(wallet.availableKopecks!==0||wallet.reservedKopecks!==0))
          throw new Error("Staging wallet did not settle the exact test quote.");
        console.log("LIVE_STAGING_SUCCESS",{
          ...(!redacted?{email}:{}),jobId,quotedUsd:providerCost.toString(),siteChargeKopecks:amount,
          walletAvailableKopecks:wallet.availableKopecks,
          walletReservedKopecks:wallet.reservedKopecks
        });
        return;
      }
      if(["unknown","failed"].includes(String(job.status)))throw new Error(
        "Job "+jobId+" is "+job.status+". Check worker logs and provider history; DO NOT resubmit."
      );
      await sleep(2000);
    }
    throw new Error("Polling timed out; check job "+jobId+" manually; do not resubmit.");
  }finally{
    if(redacted)await reportProviderBilling(jobId,userId,c.WAVESPEED_API_KEY,c.MAX_PROVIDER_COST_USD);
  }
}

main().catch(error=>{
  console.error(error instanceof Error?error.message:"Unknown error");
  process.exitCode=1;
}).finally(async()=>{await db().end();});
