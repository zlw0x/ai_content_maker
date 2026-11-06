import test from "node:test";
import assert from "node:assert/strict";
import {prepareApp} from "../src/server/model-apps";
import {inputDigest,quoteKopecks} from "../src/server/pricing";
import {hashPassword,verifyPassword} from "../src/server/security";

process.env.DATABASE_URL="postgresql://test:test@localhost:5432/test";
process.env.FX_RUB_PER_USD="90";
process.env.PRICE_MARKUP="2";
process.env.PRICE_FIXED_KOPECKS="500";

test("Text-to-image uses a vetted model and drops unrecognized properties",()=>{
  const result=prepareApp("text-to-image",{prompt:"An electric motorcycle",size:"1024*1024",admin:true});
  assert.equal(result.modelId,"wavespeed-ai/z-image/turbo");
  assert.equal(result.spec.build(result.input).admin,undefined);
});
test("Video models restrict duration and quality",()=>{
  assert.throws(()=>prepareApp("photo-to-video",{prompt:"Move camera",imageAssetId:"fa6b22f6-d683-43ad-af25-fda2d884f944",duration:90,resolution:"1080p"}));
});
test("Unknown apps cannot call arbitrary models",()=>{
  assert.throws(()=>prepareApp("provider/secret",{prompt:"hello"}));
});
test("Quotes fail for unbounded API costs",()=>{
  assert.equal(quoteKopecks("0.5"),9500);
  assert.throws(()=>quoteKopecks("100"));
});
test("Inputs have a stable SHA256 digest",()=>{
  assert.equal(inputDigest({a:1}),inputDigest({a:1}));
  assert.notEqual(inputDigest({a:1}),inputDigest({a:2}));
});
test("Passwords are hashed with randomized salts",async()=>{
  const a=await hashPassword("Secure passphrase 123");
  const b=await hashPassword("Secure passphrase 123");
  assert.notEqual(a,b);
  assert.equal(await verifyPassword("Secure passphrase 123",a),true);
  assert.equal(await verifyPassword("wrong",a),false);
});
