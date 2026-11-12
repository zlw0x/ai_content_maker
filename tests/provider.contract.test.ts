/**
 * Contract-level WaveSpeed live API tests, without a real key or spending money.
 * All outbound HTTP is stubbed. These tests cover the live adapter's HTTP contract.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import type {ClientRequest,IncomingMessage} from "node:http";
import https from "node:https";
import {providerBalance,providerPrice,priceRequestBody,submitPrediction,getPrediction,uploadWaveSpeed} from "../src/server/wavespeed";

process.env.DATABASE_URL="postgresql://test:test@localhost:5432/test";
process.env.WAVESPEED_MODE="live";
process.env.WAVESPEED_API_KEY="fixture-NOT-A-REAL-API-KEY";

type RequestRecord={url:string;method:string;auth:string|null;body:unknown};
function response(data:Record<string,unknown>,code=200){
  return Response.json({code,message:code===200?"success":"Invalid pricing inputs",data:code===200?data:undefined});
}
test("WaveSpeed live protocol: price, balance, signed upload, one submit and result polling",async context=>{
  const original=globalThis.fetch;
  const sent:RequestRecord[]=[];
  const model="wavespeed-ai/z-image/turbo";
  const inputs={prompt:"An orange scooter in a clean studio",size:"1024*1024",output_format:"jpeg"};
  const uploadUrl="https://storage.example.invalid/upload/photo%20one.png?X-Signature=a%2Bb&part=2";
  const png=Buffer.from([137,80,78,71]);
  const destroy=context.mock.fn();
  const put=context.mock.method(https,"request",(url:URL,options:https.RequestOptions,onResponse:(response:IncomingMessage)=>void)=>{
    assert.equal(url.href,uploadUrl);
    assert.equal(options.method,"PUT");
    assert.equal(options.servername,"storage.example.invalid");
    assert.equal(options.agent,false);
    assert.equal(typeof options.lookup,"function");
    const headers=new Headers(options.headers as Record<string,string>);
    assert.deepEqual([...headers.entries()],[["content-length","4"],["x-test-upload","only"]]);
    const request=Object.assign(new EventEmitter(),{
      end(body:Buffer){
        assert.deepEqual(body,png);
        queueMicrotask(()=>onResponse({statusCode:204,destroy} as unknown as IncomingMessage));
        return this;
      }
    });
    return request as unknown as ClientRequest;
  });
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
      assert.deepEqual(rec.body,{model_id:model,input:inputs});
      return response({model_id:model,currency:"USD",price:0.005,discounted_price:0.005});
    }
    if(u==="https://api.wavespeed.ai/api/v3/media/uploads"){
      assert.deepEqual(rec.body,{filename:"photo.png",size:4,content_type:"image/png"});
      return response({upload:{
        url:uploadUrl,
        method:"PUT",headers:{"X-Test-Upload":"only"}
      },download_url:"https://files.example.invalid/media/photo.png"});
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
    assert.deepEqual(priceRequestBody(model,inputs),{model_id:model,input:inputs});
    assert.equal(await providerBalance(),"2.75");
    assert.equal(await providerPrice(model,inputs),"0.005");
    assert.equal(await uploadWaveSpeed(png,"photo.png","image/png"),
      "https://files.example.invalid/media/photo.png");
    assert.equal(put.mock.callCount(),1);
    assert.equal(destroy.mock.callCount(),1);
    assert.equal(await submitPrediction(model,inputs),"pred_fixture_123");
    assert.deepEqual(await getPrediction("pred_fixture_123"),{
      id:"pred_fixture_123",status:"completed",outputs:["https://cdn.example.invalid/test.jpg"],error:undefined
    });
    assert.equal(sent.filter(x=>x.method==="POST"&&x.url.endsWith("/"+model)).length,1);
    assert.ok(sent.filter(x=>x.url.startsWith("https://api.wavespeed.ai/"))
      .every(x=>x.auth==="Bearer fixture-NOT-A-REAL-API-KEY"));
  }finally{globalThis.fetch=original;}
});
test("WaveSpeed refuses literal and non-HTTPS upload targets before sending the source",async context=>{
  let uploadUrl="";
  const ticket=context.mock.method(globalThis,"fetch",async (url:string|URL|Request)=>{
    assert.equal(String(url),"https://api.wavespeed.ai/api/v3/media/uploads");
    return response({upload:{url:uploadUrl,method:"PUT"},download_url:"https://files.example.invalid/media/photo.png"});
  });
  const put=context.mock.method(https,"request",()=>assert.fail("Unsafe upload reached the native request"));
  for (const target of [
    "https://127.1/upload",
    "https://[::ffff:127.0.0.1]/upload",
    "http://storage.example.invalid/upload",
  ]) {
    uploadUrl=target;
    await assert.rejects(()=>uploadWaveSpeed(Buffer.from([137,80,78,71]),"photo.png","image/png"),{code:"BAD_UPLOAD_TARGET"});
  }
  assert.equal(ticket.mock.callCount(),3);
  assert.equal(put.mock.callCount(),0);
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
