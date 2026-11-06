import {createReadStream} from "node:fs";
import {promises as fs} from "node:fs";
import {Readable} from "node:stream";
import path from "node:path";
import type {NextRequest} from "next/server";
import {NextResponse} from "next/server";
import {config} from "./config";
import {userAsset} from "./media";
import {HttpError} from "./errors";

type ByteRange={start:number;end:number};
export function parseRange(value:string,size:number):ByteRange|null {
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||(!match[1]&&!match[2])||size<1)return null;
  let start:number,end:number;
  if(!match[1]){
    const count=Number(match[2]);
    if(!Number.isSafeInteger(count)||count<=0)return null;
    start=Math.max(0,size-count);end=size-1;
  }else{
    start=Number(match[1]);
    end=match[2]?Number(match[2]):size-1;
  }
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
  return {start,end:Math.min(end,size-1)};
}
const viewable=new Set(["image/jpeg","image/png","image/webp","video/mp4","audio/mpeg","audio/wav"]);
const exts:Record<string,string>={
  "image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/svg+xml":"svg",
  "video/mp4":"mp4","audio/mpeg":"mp3","audio/wav":"wav"
};
export async function streamUserAsset(request:NextRequest,userId:string,assetId:string):Promise<NextResponse>{
  // DB lookup is scoped to the logged-in user before any disk access.
  const asset=await userAsset(userId,assetId);
  if(!/^(input|output)\/[a-f0-9-]{36}$/.test(asset.object_key))
    throw new HttpError(500,"INVALID_STORAGE_KEY","Invalid internal media key");
  const absolute=path.join(config().STORAGE_DIR,asset.object_key);
  let info;
  try{info=await fs.stat(absolute);}catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")throw new HttpError(404,"FILE_NOT_FOUND","Файл не найден");
    throw e;
  }
  if(!info.isFile())throw new HttpError(404,"FILE_NOT_FOUND","Файл не найден");
  const type=asset.media_type;
  const viewing=request.nextUrl.searchParams.get("view")==="1"&&viewable.has(type);
  const common:Record<string,string>={
    "Content-Type":type,
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    "Cross-Origin-Resource-Policy":"same-origin",
    "Cache-Control":"private, no-store, max-age=0",
    "Accept-Ranges":"bytes",
    "Content-Disposition":(viewing?"inline":"attachment")+'; filename="asset-'+assetId+"."+(exts[type]??"bin")+'"'
  };
  const requested=request.headers.get("range");
  const range=requested?parseRange(requested,info.size):null;
  if(requested&&!range)return new NextResponse(null,{
    status:416,headers:{...common,"Content-Range":"bytes */"+info.size}
  });
  const start=range?.start??0,end=range?.end??info.size-1;
  const headers:Record<string,string>={...common,"Content-Length":String(end-start+1)};
  if(range)headers["Content-Range"]="bytes "+start+"-"+end+"/"+info.size;
  const nodeStream=createReadStream(absolute,{start,end});
  const stream=Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(stream,{status:range?206:200,headers});
}
