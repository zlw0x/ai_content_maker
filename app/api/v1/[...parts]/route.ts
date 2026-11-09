import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {apps} from "@/lib/catalog";
import {modelSpecs} from "@/server/model-apps";
import {currentUser,beginSession,endSession,sameOrigin} from "@/server/security";
import {register,login,createQuote,createOrder,listOrders,getOrder,getUserWallet,createTopup,getTopup} from "@/server/operations";
import {saveInput} from "@/server/media";
import {streamUserAsset} from "@/server/media-delivery";
import {listLibrary,hideCompletedJob,deleteUserInput} from "@/server/library";
import {db} from "@/server/db";
import {config} from "@/server/config";
import {grantDemoCredit} from "@/server/operations";
import {assert,publicError,HttpError} from "@/server/errors";
import {createRecipeOrder,createRecipeQuote,getRecipeOrder,recipeAvailability,requireRecipeOrders} from "@/server/recipe-orders";
import {reviseRecipeOrder} from "@/server/recipe-worker";
import {applyMockRecipePayment,getRecipePayment,getRecipePaymentMode,refreshRecipePayment,requestRecipeRefund,startRecipePayment} from "@/server/recipe-payments";
import {confirmEmailVerification,startEmailVerification} from "@/server/email-verification";
import {parseRecipeFunnelEvent,recipeFunnelEnabled,recordRecipeFunnelEvent} from "@/server/recipe-funnel";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Ctx={params:Promise<{parts:string[]}>};
const uuid=z.string().uuid();
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store"}});


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
  if(path==="recipe-availability")return json({...await recipeAvailability(user.id),paymentMode:getRecipePaymentMode()});
  if(parts[0]==="recipe-orders"&&parts.length===2)return json(await getRecipeOrder(user.id,parts[1]));
  if(parts[0]==="recipe-orders"&&parts.length===3&&parts[2]==="payment")return json(await getRecipePayment(user.id,parts[1]));
  if(path==="wallet")return json(await getUserWallet(user.id));
  if(path==="library")return json(await listLibrary(user.id,request.nextUrl.searchParams.get("kind"),request.nextUrl.searchParams.get("page")));
  if(path==="orders")return json({items:await listOrders(user.id)});
  if(parts[0]==="orders"&&parts.length===2)return json(await getOrder(user.id,parts[1]));
  if(parts[0]==="topups"&&parts.length===2)return json(await getTopup(user.id,parts[1]));
  if(parts[0]==="assets"&&parts.length===2){
    assert(uuid.safeParse(parts[1]).success,422,"INVALID_ID","Неверный ID файла");
    return streamUserAsset(request,user.id,parts[1]);
  }
  throw new HttpError(404,"ENDPOINT_NOT_FOUND","Маршрут не найден");
}
async function postHandler(request:NextRequest,parts:string[]){
  sameOrigin(request);
  const path=parts.join("/");
  if(path==="recipe-funnel"){
    if(!recipeFunnelEnabled())return new NextResponse(null,{status:204});
    assert(request.headers.get("origin")===config().APP_ORIGIN,403,"BAD_ORIGIN","Запрос с другого сайта запрещён");
    const input=parseRecipeFunnelEvent(await parseJson(request));
    if(input.stage!=="example")await currentUser();
    await recordRecipeFunnelEvent(input);
    return new NextResponse(null,{status:204});
  }
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
  if(path==="auth/verify-email/start")return json(await startEmailVerification(user.id));
  if(path==="auth/verify-email/confirm")return json(await confirmEmailVerification(user.id,await parseJson(request)));
  if(path==="recipe-quotes")return json(await createRecipeQuote(user.id,await parseJson(request),request.headers.get("x-recipe-funnel-visit")),201);
  if(path==="recipe-orders")return json(await createRecipeOrder(user.id,await parseJson(request),idempotency(request),request.headers.get("x-real-ip")??"unknown"),201);
  if(parts[0]==="recipe-orders"&&parts.length===3){
    const orderId=parts[1];
    if(parts[2]==="payment"){
      requireRecipeOrders();
      return json(await startRecipePayment(user.id,orderId));
    }
    if(parts[2]==="refresh-payment")return json(await refreshRecipePayment(user.id,orderId));
    if(parts[2]==="refund")return json(await requestRecipeRefund(user.id,orderId));
    if(parts[2]==="mock-payment"){
      const input=z.object({outcome:z.enum(["succeeded","canceled"])}).strict().safeParse(await parseJson(request));
      assert(input.success,422,"RECIPE_PAYMENT_INPUT","Неизвестный статус тестовой оплаты");
      return json(await applyMockRecipePayment(user.id,orderId,input.data.outcome));
    }
  }
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

export async function PATCH(request:NextRequest,ctx:Ctx) {
  try {
    sameOrigin(request);
    const user=await currentUser();
    const {parts}=await ctx.params;
    if(parts[0]==="recipe-orders"&&parts.length===2)return json(await reviseRecipeOrder(user.id,parts[1],await parseJson(request)));
    throw new HttpError(404,"ENDPOINT_NOT_FOUND","Маршрут не найден");
  }catch(error){const info=publicError(error);return json(info.body,info.status);}
}

async function deleteHandler(request:NextRequest,parts:string[]){
  sameOrigin(request);
  const user=await currentUser();
  if(parts.length===2&&parts[0]==="library")return json(await hideCompletedJob(user.id,parts[1]));
  if(parts.length===2&&parts[0]==="assets")return json(await deleteUserInput(user.id,parts[1]));
  throw new HttpError(404,"ENDPOINT_NOT_FOUND","Маршрут не найден");
}
export async function DELETE(request:NextRequest,ctx:Ctx) {
  try{return await deleteHandler(request,(await ctx.params).parts);}
  catch(e){const info=publicError(e);return json(info.body,info.status);}
}
