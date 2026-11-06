import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {apps} from "@/lib/catalog";
import {modelSpecs} from "@/server/model-apps";
import {currentUser,beginSession,endSession,sameOrigin} from "@/server/security";
import {register,login,createQuote,createOrder,listOrders,getOrder,getUserWallet,createTopup,getTopup} from "@/server/operations";
import {saveInput,userAsset,localMedia} from "@/server/media";
import {db} from "@/server/db";
import {config} from "@/server/config";
import {grantDemoCredit} from "@/server/operations";
import {assert,publicError,HttpError} from "@/server/errors";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Ctx={params:Promise<{parts:string[]}>};
const uuid=z.string().uuid();
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});
const noStore={"Cache-Control":"private, no-store, max-age=0"};

async function parseJson(request:NextRequest):Promise<unknown> {
  const length=Number(request.headers.get("content-length")??0);
  if(length>65536)throw new HttpError(413,"BODY_TOO_LARGE","Тело запроса слишком велико");
  const raw=await request.text();
  if(Buffer.byteLength(raw)>65536)throw new HttpError(413,"BODY_TOO_LARGE","Тело запроса слишком велико");
  try{return JSON.parse(raw);}catch{throw new HttpError(400,"INVALID_JSON","Некорректный JSON");}
}
const idempotency=(r:NextRequest)=>r.headers.get("Idempotency-Key");

async function getHandler(request:NextRequest,parts:string[]) {
  const path=parts.join("/");
  if(path==="health")return json({status:"ok"});
  if(path==="system")return json({mock:config().WAVESPEED_MODE==="mock",demoCreditEnabled:config().DEMO_CREDIT_ENABLED==="true"&&config().WAVESPEED_MODE==="mock"&&config().PAYMENT_MODE==="disabled",paymentsEnabled:config().PAYMENT_MODE==="yookassa"});
  if(path==="health/ready"){await db().query("SELECT 1");return json({status:"ready"});}
  if(path==="apps")return json(apps.map(a=>({...a,enabled:Boolean(modelSpecs[a.slug])})));
  if(parts[0]==="apps"&&parts.length===2){
    const found=apps.find(a=>a.slug===parts[1]);
    assert(found,404,"APP_NOT_FOUND","Инструмент не найден");
    return json({...found,enabled:Boolean(modelSpecs[found.slug])});
  }
  if(path==="auth/me")return json(await currentUser());
  const user=await currentUser();
  if(path==="wallet")return json(await getUserWallet(user.id));
  if(path==="orders")return json({items:await listOrders(user.id)});
  if(parts[0]==="orders"&&parts.length===2)return json(await getOrder(user.id,parts[1]));
  if(parts[0]==="topups"&&parts.length===2)return json(await getTopup(user.id,parts[1]));
  if(parts[0]==="assets"&&parts.length===2){
    assert(uuid.safeParse(parts[1]).success,422,"INVALID_ID","Неверный ID файла");
    const asset=await userAsset(user.id,parts[1]);
    const bytes=await localMedia(asset.object_key);
    return new NextResponse(new Uint8Array(bytes),{headers:{
      ...noStore,"Content-Type":asset.media_type,"X-Content-Type-Options":"nosniff",
      "Content-Disposition":'attachment; filename="asset-'+parts[1]+'"'
    }});
  }
  throw new HttpError(404,"ENDPOINT_NOT_FOUND","Маршрут не найден");
}
async function postHandler(request:NextRequest,parts:string[]){
  sameOrigin(request);
  const path=parts.join("/");
  if(path==="auth/register"){
    const key="signup:"+(request.headers.get("x-real-ip")??"unknown");
    const {rateLimit,recordFailure}=await import("@/server/security");
    await rateLimit(key,10);
    await recordFailure(key);
    return json({user:await register(await parseJson(request))},201);
  }
  if(path==="auth/login"){
    // Do not trust arbitrary X-Forwarded-For unless a trusted reverse proxy sanitizes it.
    const ip=request.headers.get("x-real-ip")??"unknown";
    return json({user:await login(await parseJson(request),ip)});
  }
  if(path==="auth/logout"){await endSession();return json({ok:true});}
  const user=await currentUser();
  if(path==="assets"){
    const len=Number(request.headers.get("content-length")??0);
    if(len>11*1024*1024)throw new HttpError(413,"FILE_TOO_LARGE","Изображение должно быть меньше 10 MB");
    const form=await request.formData();
    const file=form.get("file");
    assert(file instanceof File,422,"FILE_REQUIRED","Выберите изображение");
    assert(file.size>0&&file.size<=10*1024*1024,413,"FILE_TOO_LARGE","Изображение должно быть меньше 10 MB");
    const data=Buffer.from(await file.arrayBuffer());
    return json(await saveInput(user.id,data,file.name),201);
  }
  if(path==="demo/credit")return json(await grantDemoCredit(user.id));
  if(path==="quotes")return json(await createQuote(user.id,await parseJson(request)),201);
  if(path==="orders")return json(await createOrder(user.id,await parseJson(request),idempotency(request)),201);
  if(path==="topups")return json(await createTopup(user.id,await parseJson(request),idempotency(request)),201);
  throw new HttpError(404,"ENDPOINT_NOT_FOUND","Маршрут не найден");
}
export async function GET(request:NextRequest,ctx:Ctx) {
  try{return await getHandler(request,(await ctx.params).parts);}
  catch(e){const info=publicError(e);return json(info.body,info.status);}
}
export async function POST(request:NextRequest,ctx:Ctx) {
  try{return await postHandler(request,(await ctx.params).parts);}
  catch(e){const info=publicError(e);return json(info.body,info.status);}
}
