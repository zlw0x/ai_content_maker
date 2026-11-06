import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {db,transaction} from "../src/server/db";
import {creditConfirmedPayment} from "../src/server/wallet";

const origin=process.env.APP_ORIGIN??"http://localhost:3000";
async function main(){
  const email="smoke-"+randomUUID()+"@example.invalid";
  let cookie="";
  async function api(path:string,method="GET",payload?:unknown,key?:string){
    const response=await fetch(origin+path,{
      method,
      headers:{"Content-Type":"application/json","Origin":origin,...(cookie?{"Cookie":cookie}:{}),...(key?{"Idempotency-Key":key}:{})},
      body:payload?JSON.stringify(payload):undefined,redirect:"manual"
    });
    const body=await response.json();
    return {response,body};
  }
  assert.equal((await api("/api/v1/health")).response.status,200);
  assert.equal((await api("/api/v1/wallet")).response.status,401);
  const registered=await api("/api/v1/auth/register","POST",{email,password:"Smoketest Password 123"});
  assert.equal(registered.response.status,201,JSON.stringify(registered.body));
  cookie=registered.response.headers.get("set-cookie")?.split(";")[0]??"";
  assert.ok(cookie.startsWith("acm_session="));
  const userId=registered.body.user.id as string;
  const credit=50000;
  await transaction(async c=>{
    const id=randomUUID();
    await c.query(`INSERT INTO payments(id,user_id,client_idempotency_key,amount_kopecks,status,provider,external_payment_id)
      VALUES($1,$2,$3,$4,'succeeded','dev',$5)`,[id,userId,id,credit,"dev-"+id]);
    await creditConfirmedPayment(c,id,userId,credit);
  });
  const quote=await api("/api/v1/quotes","POST",{appSlug:"text-to-image",input:{prompt:"An abstract electric blue sculpture"}});
  assert.equal(quote.response.status,201,JSON.stringify(quote.body));
  const key=randomUUID();
  const body={quoteId:quote.body.id};
  const order=await api("/api/v1/orders","POST",body,key);
  assert.equal(order.response.status,201,JSON.stringify(order.body));
  const duplicated=await api("/api/v1/orders","POST",body,key);
  assert.equal(duplicated.body.id,order.body.id);
  const wallet=await api("/api/v1/wallet");
  assert.equal(wallet.body.availableKopecks+wallet.body.reservedKopecks,credit);
  let finished;
  for(let i=0;i<30;i++){
    finished=await api("/api/v1/orders/"+order.body.id);
    if(finished.body.status==="completed")break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(finished?.body.status,"completed",JSON.stringify(finished?.body));
  assert.equal(finished.body.outputs.length,1);
  const downloaded=await fetch(origin+finished.body.outputs[0].url,{headers:{Cookie:cookie}});
  assert.equal(downloaded.status,200);
  assert.equal(downloaded.headers.get("content-type"),"image/svg+xml");
  const finalWallet=await api("/api/v1/wallet");
  assert.equal(finalWallet.body.reservedKopecks,0);
  assert.equal(finalWallet.body.availableKopecks,credit-quote.body.amountKopecks);
  const bad=await api("/api/v1/quotes","POST",{appSlug:"text-to-image",input:{prompt:"a"}});
  assert.equal(bad.response.status,422);
  console.log("Smoke OK — account, quote, wallet, idempotent job, mocked output, access control");
  await db().end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
