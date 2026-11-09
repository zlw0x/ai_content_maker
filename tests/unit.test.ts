import test from "node:test";
import assert from "node:assert/strict";
import {prepareApp,modelSpecs} from "../src/server/model-apps";
import {apps} from "../src/lib/catalog";
import {safeNext} from "../src/lib/api-client";
import {getProductCardExample,productCardExamples} from "../src/lib/product-card-examples";
import {createProductCardRecipe,ProductCardInputError} from "../src/lib/product-card-recipe";
import {inputDigest,quoteKopecks} from "../src/server/pricing";
import {hashPassword,verifyPassword} from "../src/server/security";
import {parseRange} from "../src/server/media-delivery";
import {priceRequestBody} from "../src/server/wavespeed";
import {classifyApp} from "../src/server/library";
import {checkedOutputType} from "../src/server/media";

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
test("Only provider-backed catalog apps have an allowlisted model adapter",()=>{
  for(const item of apps)assert.equal(Boolean(modelSpecs[item.slug]),item.mode!=="product-card",item.slug);
});
test("Sign-in redirects keep known local paths and reject external paths disguised with control characters",()=>{
  const next="/apps/product-card?example=candle-dark";
  assert.equal(safeNext(next),next);
  assert.equal(safeNext("//example.invalid"),"/dashboard");
  assert.equal(safeNext("/\n/example.invalid"),"/dashboard");
  assert.equal(safeNext("/\t/example.invalid"),"/dashboard");
  assert.equal(safeNext("/\\example.invalid"),"/dashboard");
});
test("Showcase has twelve unique, local, selectable product-card examples",()=>{
  assert.equal(productCardExamples.length,12);
  assert.equal(new Set(productCardExamples.map(example=>example.id)).size,12);
  for(const example of productCardExamples){
    assert.equal(getProductCardExample(example.id),example);
    assert.match(example.beforeUrl,/^\/examples\/product-card\/[a-z-]+\.png$/);
    assert.match(example.afterUrl,/^\/examples\/product-card\/[a-z-]+\.webp$/);
  }
  assert.equal(getProductCardExample("https://example.invalid"),undefined);
});
test("Local product recipe reuses the same run and renders changed uploads or styles",async()=>{
  const file=new File(["image"],"same.png",{type:"image/png"});
  const calls: unknown[][]=[];
  const run=createProductCardRecipe(async (...args)=>{
    calls.push(args);
    return new Blob(["rendered"],{type:"image/png"});
  });
  const input={source:{file},title:"  Свеча ",benefit:"Два  фитиля",styleId:"dark"} as const;
  const normalized={...input,title:"Свеча",benefit:"Два фитиля"};
  const [first,concurrent]=await Promise.all([run(input),run(normalized)]);
  assert.equal(first,concurrent);
  assert.equal(first,await run(normalized));
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(0,3),[file,"Свеча","Два фитиля"]);

  const restyled=await run({...input,styleId:"bright"});
  assert.notEqual(restyled,first);
  const replacement=new File(["different"],file.name,{type:file.type});
  assert.notEqual(await run({...input,styleId:"bright",source:{file:replacement}}),restyled);
  assert.equal(calls.length,3);
});

test("Local product recipe validates before rendering and allows retry after a failed run",async()=>{
  let attempts=0;
  const run=createProductCardRecipe(async ()=>{
    if (++attempts===1) throw new Error("render failed");
    return new Blob(["rendered"],{type:"image/png"});
  });
  const input={source:{file:new File(["image"],"photo.png",{type:"image/png"})},title:"Свеча",benefit:"",styleId:"minimal"} as const;
  await assert.rejects(run({...input,title:"  "}),ProductCardInputError);
  await assert.rejects(run({...input,source:{exampleId:"https://example.invalid/photo.png"}}),ProductCardInputError);
  await assert.rejects(run({...input,source:{file:new File([],"empty.png",{type:"image/png"})}}),ProductCardInputError);
  assert.equal(attempts,0);
  await assert.rejects(run(input),/render failed/);
  assert.equal((await run(input)).type,"image/png");
  assert.equal(attempts,2);
});
test("B-roll compiles a short scene and allowed mood into a fixed five-second video",()=>{
  const app=prepareApp("ai-b-roll",{prompt:"  Пар над чашкой кофе  ",mood:"soft",orientation:"portrait",duration:30});
  const request=app.spec.build(app.input);
  assert.equal(app.modelId,modelSpecs["text-to-video"].modelId);
  assert.equal(app.input.prompt,"Пар над чашкой кофе");
  assert.match(String(request.prompt),/diffused light.*Пар над чашкой кофе/);
  assert.equal(request.duration,5);
  assert.equal(request.size,"480*832");
  assert.throws(()=>prepareApp("ai-b-roll",{prompt:"Пар над чашкой кофе",mood:"arbitrary"}));
  assert.throws(()=>prepareApp("ai-b-roll",{prompt:"x".repeat(241)}));
  assert.equal(classifyApp("ai-b-roll"),"video");
});
test("Voiceover allows only predefined voice IDs",()=>{
  const spec=prepareApp("ai-voiceover",{text:"Привет, мир!",voice:"Russian_BrightHeroine",speed:1});
  assert.equal(spec.modelId,"minimax/speech-2.6-hd");
  assert.equal(spec.spec.build(spec.input).language_boost,"Russian");
  assert.throws(()=>prepareApp("ai-voiceover",{text:"Привет",voice:"arbitrary-id"}));
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

test("Premium image uses distinct higher-tier Seedream model",()=>{
  const app=prepareApp("premium-image",{prompt:"Detailed studio product image",size:"1536*1024"});
  assert.equal(app.modelId,"bytedance/seedream-v5.0-pro");
  assert.equal(app.spec.build(app.input).aspect_ratio,"3:2");
  assert.equal(app.spec.build(app.input).resolution,"1k");
});

test("Pricing API uses documented singular input for dynamic request pricing",()=>{
  assert.deepEqual(priceRequestBody("wavespeed-ai/z-image/turbo",{prompt:"Hello",size:"1024*1024"}),{
    model_id:"wavespeed-ai/z-image/turbo",input:{prompt:"Hello",size:"1024*1024"}
  });
  assert.equal("inputs" in priceRequestBody("a",{prompt:"x"}),false);
  assert.deepEqual(priceRequestBody("dynamic/model",{}),{model_id:"dynamic/model",input:{}});
});
test("Media Range parser supports seek and suffix but rejects multi-range",()=>{
  assert.deepEqual(parseRange("bytes=0-9",100),{start:0,end:9});
  assert.deepEqual(parseRange("bytes=90-",100),{start:90,end:99});
  assert.deepEqual(parseRange("bytes=-10",100),{start:90,end:99});
  assert.deepEqual(parseRange("bytes=90-999",100),{start:90,end:99});
  assert.equal(parseRange("bytes=100-",100),null);
  assert.equal(parseRange("bytes=0-1,4-8",100),null);
  assert.equal(parseRange("bytes=-0",100),null);
  assert.equal(parseRange("bytes=3-2",100),null);
});
test("Gallery media kind uses stable app mapping independent of mock MIME",()=>{
  assert.equal(classifyApp("photo-to-video"),"video");
  assert.equal(classifyApp("ai-voiceover"),"audio");
  assert.equal(classifyApp("text-to-image"),"image");
});

test("CDN octet-stream is recognized from content, not served as HTML or SVG",()=>{
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yf6XVwAAAAASUVORK5CYII=","base64");
  const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1]);
  const mp4=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,2,0]);
  const wav=Buffer.from("RIFF0000WAVEfmt ","ascii");
  const mp3=Buffer.from("ID3\u0003\u0000\u0000","binary");
  assert.equal(checkedOutputType(png,"application/octet-stream"),"image/png");
  assert.equal(checkedOutputType(jpeg,""),"image/jpeg");
  assert.equal(checkedOutputType(mp4,"video/mp4"),"video/mp4");
  assert.equal(checkedOutputType(wav,"application/octet-stream"),"audio/wav");
  assert.equal(checkedOutputType(mp3,"audio/mpeg"),"audio/mpeg");
  assert.throws(()=>checkedOutputType(Buffer.from("<svg><script>alert(1)</script></svg>"),"application/octet-stream"));
  assert.throws(()=>checkedOutputType(png,"text/html"));
  assert.throws(()=>checkedOutputType(png,"image/jpeg"));
});
