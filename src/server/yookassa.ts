import { config } from "./config";
import { HttpError } from "./errors";

type Payment = {
  id:string;
  status:"pending"|"succeeded"|"canceled"|"waiting_for_capture";
  paid:boolean;
  amount:{value:string;currency:string};
  metadata?:Record<string,string>;
  confirmation?:{type:string;confirmation_url?:string};
};
function auth():string {
  const c=config();
  if(c.PAYMENT_MODE!=="yookassa"||!c.YOOKASSA_SHOP_ID||!c.YOOKASSA_SECRET_KEY)
    throw new HttpError(503,"PAYMENTS_DISABLED","Оплата пока не подключена");
  return "Basic "+Buffer.from(c.YOOKASSA_SHOP_ID+":"+c.YOOKASSA_SECRET_KEY).toString("base64");
}
async function call(endpoint:string,method:"GET"|"POST",body?:object,idempotency?:string):Promise<Payment> {
  const response=await fetch("https://api.yookassa.ru/v3"+endpoint,{
    method,
    headers:{
      Authorization:auth(),
      "Content-Type":"application/json",
      ...(idempotency?{"Idempotence-Key":idempotency}:{})
    },
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(30000),redirect:"error",cache:"no-store"
  });
  if(!response.ok)throw new HttpError(502,"PAYMENT_PROVIDER_ERROR","ЮKassa вернула ошибку "+response.status);
  const data=await response.json() as Payment;
  if(!data.id||!data.amount||!data.status)throw new HttpError(502,"INVALID_PAYMENT","Неверный ответ ЮKassa");
  return data;
}
export async function createSbpPayment(paymentId:string,kopecks:number):Promise<Payment> {
  return call("/payments","POST",{
    amount:{value:(kopecks/100).toFixed(2),currency:"RUB"},
    capture:true,
    payment_method_data:{type:"sbp"},
    confirmation:{type:"redirect",return_url:config().APP_ORIGIN+"/"},
    description:"Пополнение AI Content Maker",
    metadata:{payment_id:paymentId}
  },paymentId);
}
export async function verifySbpPayment(externalId:string):Promise<Payment> {
  if(!/^[a-zA-Z0-9-]{10,80}$/.test(externalId))throw new HttpError(422,"INVALID_PAYMENT_ID","Неверный ID платежа");
  return call("/payments/"+encodeURIComponent(externalId),"GET");
}
export function amountInKopecks(payment:Payment):number {
  if(payment.amount.currency!=="RUB"||!/^\d+\.\d{2}$/.test(payment.amount.value))
    throw new HttpError(502,"PAYMENT_AMOUNT_INVALID","Валюта/сумма платежа не совпадает");
  const [r,k]=payment.amount.value.split(".");
  const result=Number(r)*100+Number(k);
  if(!Number.isSafeInteger(result))throw new HttpError(502,"PAYMENT_AMOUNT_INVALID","Слишком большая сумма");
  return result;
}
export type {Payment};
