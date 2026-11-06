import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {db} from "../src/server/db";

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
  const credit=50000;
  const testBalance=await api("/api/v1/demo/credit","POST",{});
  assert.equal(testBalance.response.status,200,JSON.stringify(testBalance.body));
  assert.equal(testBalance.body.credited,true);
  const again=await api("/api/v1/demo/credit","POST",{});
  assert.equal(again.body.credited,false);
  assert.equal(again.body.amountKopecks,0);
  const quote=await api("/api/v1/quotes","POST",{appSlug:"text-to-image",input:{prompt:"An abstract electric blue sculpture"}});
  assert.equal(quote.response.status,201,JSON.stringify(quote.body));
  const key=randomUUID();
  const body={quoteId:quote.body.id};
  const order=await api("/api/v1/orders","POST",body,key);
  assert.equal(order.response.status,201,JSON.stringify(order.body));
  const duplicated=await api("/api/v1/orders","POST",body,key);
  assert.equal(duplicated.body.id,order.body.id);
  const differentQuote=await api("/api/v1/quotes","POST",{appSlug:"text-to-image",input:{prompt:"Another valid abstract city"}});
  assert.equal(differentQuote.response.status,201);
  const conflict=await api("/api/v1/orders","POST",{quoteId:differentQuote.body.id},key);
  assert.equal(conflict.response.status,409);
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
  // Cover media upload, owner validation, image adapter, and voiceover.
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yf6XVwAAAAASUVORK5CYII=","base64");
  const form=new FormData();
  form.append("file",new Blob([png],{type:"image/png"}),"pixel.png");
  const uploaded=await fetch(origin+"/api/v1/assets",{
    method:"POST",headers:{Origin:origin,Cookie:cookie},body:form
  });
  assert.equal(uploaded.status,201);
  const image=await uploaded.json();
  const up=await api("/api/v1/quotes","POST",{appSlug:"upscale",input:{imageAssetId:image.id}});
  assert.equal(up.response.status,201,JSON.stringify(up.body));
  const audio=await api("/api/v1/quotes","POST",{appSlug:"ai-voiceover",input:{text:"Добро пожаловать!",voice:"Russian_BrightHeroine"}});
  assert.equal(audio.response.status,201,JSON.stringify(audio.body));
  for(const item of [up,audio]){
    const o=await api("/api/v1/orders","POST",{quoteId:item.body.id},randomUUID());
    assert.equal(o.response.status,201,JSON.stringify(o.body));
    let status="";
    for(let i=0;i<30;i++){
      const r=await api("/api/v1/orders/"+o.body.id);status=r.body.status;
      if(status==="completed")break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    assert.equal(status,"completed");
  }
  const after=await api("/api/v1/wallet");
  assert.equal(after.body.reservedKopecks,0);
  assert.equal(after.body.availableKopecks,credit-quote.body.amountKopecks-up.body.amountKopecks-audio.body.amountKopecks);

  // Full tenant-isolation test: another authenticated user cannot inspect,
  // download, delete or reuse another user's references or results.
  const ownerCookie=cookie;
  const ownerJob=await api("/api/v1/orders/"+order.body.id);
  assert.equal(ownerJob.response.status,200);
  assert.equal(ownerJob.body.repeatInput.prompt,"An abstract electric blue sculpture");
  assert.equal(JSON.stringify(ownerJob.body.repeatInput).includes("mock://"),false);
  const gallery=await api("/api/v1/library?kind=image&page=0");
  assert.equal(gallery.response.status,200);
  assert.ok(gallery.body.items.some((entry:{id:string})=>entry.id===order.body.id));
  const assetUrl=finished.body.outputs[0].url as string;
  const ranged=await fetch(origin+assetUrl,{headers:{Cookie:ownerCookie,Range:"bytes=0-9"}});
  assert.equal(ranged.status,206);
  assert.equal(ranged.headers.get("content-range")?.startsWith("bytes 0-9/"),true);
  assert.equal((await ranged.arrayBuffer()).byteLength,10);
  const svgInline=await fetch(origin+assetUrl+"?view=1",{headers:{Cookie:ownerCookie}});
  assert.equal(svgInline.headers.get("content-disposition")?.startsWith("attachment"),true);
  const badRange=await fetch(origin+assetUrl,{headers:{Cookie:ownerCookie,Range:"bytes=100000-"}});
  assert.equal(badRange.status,416);

  const stranger=await api("/api/v1/auth/register","POST",{
    email:"stranger-"+randomUUID()+"@example.invalid",password:"Another test Password 2026!"
  });
  assert.equal(stranger.response.status,201);
  cookie=stranger.response.headers.get("set-cookie")?.split(";")[0]??"";
  assert.notEqual(cookie,ownerCookie);
  assert.equal((await api("/api/v1/library")).body.items.length,0);
  assert.equal((await api("/api/v1/orders/"+order.body.id)).response.status,404);
  assert.equal((await fetch(origin+assetUrl,{headers:{Cookie:cookie}})).status,404);
  assert.equal((await api("/api/v1/library/"+order.body.id,"DELETE")).response.status,404);
  assert.equal((await fetch(origin+"/api/v1/assets/"+image.id,{headers:{Cookie:cookie}})).status,404);
  const crossQuote=await api("/api/v1/quotes","POST",{appSlug:"upscale",input:{imageAssetId:image.id}});
  assert.equal(crossQuote.response.status,404);
  cookie=ownerCookie;
  const deleted=await api("/api/v1/library/"+order.body.id,"DELETE");
  assert.equal(deleted.response.status,200);
  assert.equal((await api("/api/v1/orders/"+order.body.id)).response.status,404);
  assert.equal((await fetch(origin+assetUrl,{headers:{Cookie:ownerCookie}})).status,404);
  assert.equal((await api("/api/v1/library")).body.items.some((x:{id:string})=>x.id===order.body.id),false);
  const deleteInput=await api("/api/v1/assets/"+image.id,"DELETE");
  assert.equal(deleteInput.response.status,200,JSON.stringify(deleteInput.body));
  assert.equal((await fetch(origin+"/api/v1/assets/"+image.id,{headers:{Cookie:ownerCookie}})).status,404);
  const bad=await api("/api/v1/quotes","POST",{appSlug:"text-to-image",input:{prompt:"a"}});
  assert.equal(bad.response.status,422);
  console.log("Smoke OK — tenant-isolated media library, streaming Range, deletion, repeat metadata and financial workflow");
  await db().end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
