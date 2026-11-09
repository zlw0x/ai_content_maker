import { config } from "./config";
import { HttpError } from "./errors";
import { parseProviderMediaUrl, putProviderMedia } from "./provider-media-http";

const BASE = "https://api.wavespeed.ai/api/v3";
type Payload = {code?:number;message?:string;data?:Record<string,unknown>};
export type Prediction = {id:string;status:string;outputs:string[];error?:string};

function apiKey() {
  const key=config().WAVESPEED_API_KEY;
  if(!key) throw new HttpError(503,"PROVIDER_NOT_READY","WaveSpeed API key отсутствует");
  return key;
}
async function call(path:string,method:"POST"|"GET", body?:object):Promise<Record<string,unknown>> {
  const response=await fetch(BASE+path,{
    method,headers:{"Authorization":"Bearer "+apiKey(),"Content-Type":"application/json"},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(45000),cache:"no-store",redirect:"error"
  });
  if(!response.ok) throw new HttpError(502,"PROVIDER_HTTP_"+response.status,"Ошибка WaveSpeed API ("+response.status+")");
  const raw=await response.json() as Payload;
  if(raw.code!==200||!raw.data) throw new HttpError(502,"PROVIDER_ERROR","Некорректный ответ WaveSpeed API: "+String(raw.message??"unknown"));
  return raw.data;
}
export async function providerBalance():Promise<string>{
  const data=await call("/balance","GET");
  if(typeof data.balance!=="number"||!Number.isFinite(data.balance)||data.balance<0)
    throw new HttpError(502,"PROVIDER_BALANCE_INVALID","WaveSpeed returned invalid balance");
  return String(data.balance);
}
export function priceRequestBody(modelId:string,input:Record<string,unknown>){
  return {model_id:modelId,input};
}
export async function providerPrice(modelId:string, input:Record<string,unknown>):Promise<string> {
  if(config().WAVESPEED_MODE==="mock") return String(config().MOCK_COST_USD);
  const data=await call("/model/price","POST",priceRequestBody(modelId,input));
  const price=data.discounted_price;
  if(typeof price!=="number"||!Number.isFinite(price)||price<0||data.currency!=="USD")
    throw new HttpError(503,"PRICE_INVALID","Провайдер не предоставил действительную цену");
  return String(price);
}
export async function uploadWaveSpeed(buffer:Buffer, filename:string,mime:string):Promise<string> {
  if(config().WAVESPEED_MODE==="mock") return "mock://input/"+filename;
  const ticket=await call("/media/uploads","POST",{filename,size:buffer.byteLength,content_type:mime});
  const upload=ticket.upload as {method?:string;url?:string;headers?:Record<string,string>}|undefined;
  if(!upload||upload.method!=="PUT"||typeof upload.url!=="string"||typeof ticket.download_url!=="string") throw new HttpError(502,"BAD_UPLOAD_TICKET","Не удалось получить ссылку для загрузки");
  // Upload URL is an opaque temporary credential issued by WaveSpeed; do not log it or send API key to it.
  const url=parseProviderMediaUrl(upload.url);
  if(!url) throw new HttpError(502,"BAD_UPLOAD_TARGET","Недопустимый адрес хранилища");
  await putProviderMedia(url,buffer,upload.headers);
  return ticket.download_url;
}
export async function submitPrediction(modelId:string,input:Record<string,unknown>):Promise<string> {
  if(config().WAVESPEED_MODE==="mock") return "mock-"+crypto.randomUUID();
  const callback=config().WAVESPEED_CALLBACK_URL;
  const suffix=callback?"?standard_webhook="+encodeURIComponent(callback):"";
  // DO NOT retry this POST on network errors. Upstream may have charged it already.
  const data=await call("/"+modelId+suffix,"POST",input);
  if(typeof data.id!=="string"||!data.id) throw new HttpError(502,"UNKNOWN_PROVIDER_SUBMISSION","WaveSpeed did not return prediction ID");
  return data.id;
}
export async function getPrediction(id:string, options?: { requireIdMatch?: boolean }):Promise<Prediction> {
  if(id.startsWith("mock-")&&config().WAVESPEED_MODE==="mock") return {id,status:"completed",outputs:[]};
  if(!/^[\w-]{5,180}$/.test(id)) throw new HttpError(422,"INVALID_PREDICTION","Invalid provider ID");
  const data=await call("/predictions/"+encodeURIComponent(id)+"/result","GET");
  if(options?.requireIdMatch&&data.id!==id)throw new HttpError(502,"PREDICTION_ID_MISMATCH","WaveSpeed не подтвердил ID результата");
  return {
    id:String(data.id??id),
    status:String(data.status??"processing"),
    outputs:Array.isArray(data.outputs)?data.outputs.filter((v):v is string=>typeof v==="string"&&/^https:\/\//.test(v)):[],
    error:typeof data.error==="string"?data.error:undefined
  };
}
