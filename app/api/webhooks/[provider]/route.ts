import {createHmac,timingSafeEqual} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {config} from "@/server/config";
import {db} from "@/server/db";
import {reconcileTopup} from "@/server/operations";
import {HttpError,publicError} from "@/server/errors";
import {applyRecipePaymentEvent,applyRecipeRefundEvent,getRecipePaymentMode} from "@/server/recipe-payments";

export const runtime="nodejs";
type Ctx={params:Promise<{provider:string}>};
function verifyWaveSpeed(body:string,request:NextRequest):string {
  const secret=config().WAVESPEED_WEBHOOK_SECRET;
  if(!secret||!secret.startsWith("whsec_"))throw new HttpError(503,"WEBHOOK_NOT_CONFIGURED","Webhook secret не настроен");
  const id=request.headers.get("webhook-id");
  const timestamp=request.headers.get("webhook-timestamp");
  const signature=request.headers.get("webhook-signature");
  if(!id||!timestamp||!signature||!/^[0-9]{9,12}$/.test(timestamp)||
    Math.abs(Date.now()/1000-Number(timestamp))>300)throw new HttpError(401,"WEBHOOK_INVALID","Некорректные заголовки webhook");
  const key=Buffer.from(secret.slice(6),"base64");
  const expected=createHmac("sha256",key).update(id+"."+timestamp+"."+body).digest();
  const accepted=signature.split(" ").some(part=>{
    if(!part.startsWith("v1,"))return false;
    const actual=Buffer.from(part.slice(3),"base64");
    return actual.length===expected.length&&timingSafeEqual(actual,expected);
  });
  if(!accepted)throw new HttpError(401,"WEBHOOK_INVALID","Подпись webhook не совпадает");
  return id;
}
export async function POST(request:NextRequest,ctx:Ctx) {
  try {
    const {provider}=await ctx.params;
    const raw=await request.text();
    if(Buffer.byteLength(raw)>128000)throw new HttpError(413,"WEBHOOK_TOO_LARGE","Payload too large");
    if(provider==="wavespeed"){
      const eventId=verifyWaveSpeed(raw,request);
      const event=JSON.parse(raw) as {id?:string;status?:string};
      if(!event.id||typeof event.id!=="string")throw new HttpError(422,"INVALID_EVENT","Missing prediction ID");
      // Signed notification is only a wake-up. Worker independently fetches trusted prediction state.
      await db().query(`INSERT INTO webhook_events(provider,event_id) VALUES('wavespeed',$1) ON CONFLICT DO NOTHING`,[eventId]);
      await db().query(`UPDATE generation_jobs SET last_polled_at=NULL WHERE provider='wavespeed'
        AND provider_prediction_id=$1 AND status='processing'`,[event.id]);
      return NextResponse.json({ok:true});
    }
    if(provider==="yookassa"){
      if(config().PAYMENT_MODE!=="yookassa")throw new HttpError(503,"PAYMENTS_DISABLED","Payments disabled");
      const event=JSON.parse(raw) as {event?:string;object?:{id?:string}};
      if(!event.event?.startsWith("payment.")||!event.object?.id)return NextResponse.json({ok:true});
      // YooKassa does not provide a shared-secret signature for this flow.
      // Ignore any supplied amounts/status; fetch the payment server-to-server.
      await reconcileTopup(event.object.id);
      return NextResponse.json({ok:true});
    }
    if(provider==="recipe-yookassa"){
      if(getRecipePaymentMode()!=="yookassa-test")throw new HttpError(503,"PAYMENTS_DISABLED","Тестовые платежи отключены");
      const event=JSON.parse(raw) as {event?:string;object?:{id?:string}};
      if(typeof event.object?.id!=="string"||typeof event.event!=="string")return NextResponse.json({ok:true});
      if(event.event.startsWith("payment."))await applyRecipePaymentEvent(event.object.id);
      if(event.event.startsWith("refund."))await applyRecipeRefundEvent(event.object.id);
      return NextResponse.json({ok:true});
    }
    throw new HttpError(404,"ENDPOINT_NOT_FOUND","Unknown webhook provider");
  }catch(error){
    const info=publicError(error);
    return NextResponse.json(info.body,{status:info.status});
  }
}
