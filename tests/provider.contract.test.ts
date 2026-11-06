/**
 * Contract-level WaveSpeed live API tests, without a real key or spending money.
 * Every outbound fetch is stubbed. Test adapter HTTP semantics rather than mock mode.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {providerBalance,providerPrice,priceRequestBody,submitPrediction,getPrediction,uploadWaveSpeed} from "../src/server/wavespeed";

process.env.DATABASE_URL="postgresql://test:test@localhost:5432/test";
process.env.WAVESPEED_MODE="live";
process.env.WAVESPEED_API_KEY="fixture-NOT-A-REAL-API-KEY";

type RequestRecord={url:string;method:string;auth:string|null;body:unknown};
function response(data:Record<string,unknown>,code=200){
  return Response.json({code,message:code===200?"success":"Invalid pricing inputs",data:code===200?data:undefined});
}
test("WaveSpeed live protocol: price, balance, signed upload, one submit and result polling",async()=>{
  const original=globalThis.fetch;
  const sent:RequestRecord[]=[];
  const model="wavespeed-ai/z-image/turbo";
  const inputs={prompt:"An orange scooter in a clean studio",size:"1024*1024",output_format:"jpeg"};
  globalThis.fetch=async(url,options)=>{
    const u=String(url),opt=options??{};
    const auth=new Headers(opt.headers).get("Authorization");
    const rec={url:u,method:opt.method??"GET",auth,body:opt.body?(
      typeof opt.body==="string"?JSON.parse(opt.body):"<binary>"
    ):null};
    sent.push(rec);
    if(u==="https://api.wavespeed.ai/api/v3/balance"){
      assert.equal(rec.method,"GET");
      return response({balance:2.75});
    }
    if(u==="https://api.wavespeed.ai/api/v3/model/price"){
      assert.equal(rec.method,"POST");
      assert.deepEqual(rec.body,{model_id:model,inputs});
      return response({model_id:model,currency:"USD",price:0.005,discounted_price:0.005});
    }
    if(u==="https://api.wavespeed.ai/api/v3/media/uploads"){
      assert.deepEqual(rec.body,{filename:"photo.png",size:4,content_type:"image/png"});
      return response({upload:{
        url:"https://storage.example.invalid/upload/signed-once",
        method:"PUT",headers:{"X-Test-Upload":"only"}
      },download_url:"https://files.example.invalid/media/photo.png"});
    }
    if(u==="https://storage.example.invalid/upload/signed-once"){
      assert.equal(rec.method,"PUT");
      assert.equal(rec.auth,null);
      assert.equal(new Headers(opt.headers).get("X-Test-Upload"),"only");
      return new Response(null,{status:200});
    }
    if(u==="https://api.wavespeed.ai/api/v3/"+model){
      assert.equal(rec.method,"POST");
      assert.deepEqual(rec.body,inputs);
      return response({id:"pred_fixture_123",status:"created",outputs:[]});
    }
    if(u==="https://api.wavespeed.ai/api/v3/predictions/pred_fixture_123/result"){
      assert.equal(rec.method,"GET");
      return response({id:"pred_fixture_123",status:"completed",outputs:["https://cdn.example.invalid/test.jpg"]});
    }
    throw new Error("Unexpected external URL "+u);
  };
  try{
    assert.deepEqual(priceRequestBody(model,inputs),{model_id:model,inputs});
    assert.equal(await providerBalance(),"2.75");
    assert.equal(await providerPrice(model,inputs),"0.005");
    assert.equal(await uploadWaveSpeed(Buffer.from([137,80,78,71]),"photo.png","image/png"),
      "https://files.example.invalid/media/photo.png");
    assert.equal(await submitPrediction(model,inputs),"pred_fixture_123");
    assert.deepEqual(await getPrediction("pred_fixture_123"),{
      id:"pred_fixture_123",status:"completed",outputs:["https://cdn.example.invalid/test.jpg"],error:undefined
    });
    assert.equal(sent.filter(x=>x.method==="POST"&&x.url.endsWith("/"+model)).length,1);
    assert.ok(sent.filter(x=>x.url.startsWith("https://api.wavespeed.ai/"))
      .every(x=>x.auth==="Bearer fixture-NOT-A-REAL-API-KEY"));
  }finally{globalThis.fetch=original;}
});
test("WaveSpeed pricing refuses business errors, missing currency, and blank provider costs",async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>response({},4005);
    await assert.rejects(()=>providerPrice("test/model",{prompt:"x"}),/Некорректный ответ WaveSpeed API/);
    globalThis.fetch=async()=>response({currency:"EUR",discounted_price:0.005});
    await assert.rejects(()=>providerPrice("test/model",{prompt:"x"}),/действительную цену/);
    globalThis.fetch=async()=>response({currency:"USD"});
    await assert.rejects(()=>providerPrice("test/model",{prompt:"x"}),/действительную цену/);
  }finally{globalThis.fetch=original;}
});
