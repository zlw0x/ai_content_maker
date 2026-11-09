import assert from "node:assert/strict";
import test from "node:test";
import {readPredictionBilling} from "../scripts/wavespeed-billing";

const predictionId="pred_test_001";

test("WaveSpeed staging reports only the deduction for the exact prediction",async t=>{
  const request=t.mock.method(globalThis,"fetch",async (url:string,options:RequestInit)=>{
    assert.equal(url,"https://api.wavespeed.ai/api/v3/billings/search");
    assert.equal(options.method,"POST");
    assert.deepEqual(JSON.parse(String(options.body)),{
      prediction_uuids:[predictionId],billing_type:"deduct",page:1,page_size:100
    });
    return Response.json({code:200,data:{has_more:false,items:[
      {uuid:"bill-1",billing_type:"deduct",price:0.001,prediction:{uuid:predictionId}},
      {uuid:"bill-2",billing_type:"deduct",price:0.004,prediction:{uuid:predictionId}}
    ]}});
  });
  assert.deepEqual(await readPredictionBilling("test-key",predictionId),{
    status:"confirmed",chargedUsd:"0.005",recordCount:2
  });
  assert.equal(request.mock.callCount(),1);
});

test("WaveSpeed staging separates billing access failure from generation status",async t=>{
  const request=t.mock.method(globalThis,"fetch",async ()=>new Response(null,{status:403}));
  assert.deepEqual(await readPredictionBilling("test-key",predictionId),{
    status:"pending",reason:"permission"
  });
  assert.equal(request.mock.callCount(),1);
});

test("WaveSpeed staging rejects an itemized charge for another prediction",async t=>{
  t.mock.method(globalThis,"fetch",async ()=>Response.json({code:200,data:{has_more:false,items:[
    {uuid:"bill-other",billing_type:"deduct",price:0.005,prediction:{uuid:"pred_test_002"}}
  ]}}));
  assert.deepEqual(await readPredictionBilling("test-key",predictionId),{
    status:"pending",reason:"unexpected_response"
  });
});
