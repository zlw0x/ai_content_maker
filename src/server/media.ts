import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { config } from "./config";
import { db,one } from "./db";
import { assert, HttpError } from "./errors";

const MAX_INPUT=10*1024*1024;
const MAX_OUTPUT=80*1024*1024;

export function sniffImage(buffer:Buffer):string {
  if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
  if(buffer.length>=3&&buffer.subarray(0,3).equals(Buffer.from([255,216,255])))return "image/jpeg";
  if(buffer.length>=12&&buffer.toString("ascii",0,4)==="RIFF"&&buffer.toString("ascii",8,12)==="WEBP")return "image/webp";
  throw new HttpError(422,"INVALID_IMAGE","Поддерживаются только JPG, PNG и WebP");
}
export async function saveInput(userId:string,buffer:Buffer,filename:string):Promise<{id:string;mediaType:string}> {
  assert(buffer.length>0&&buffer.length<=MAX_INPUT,413,"FILE_TOO_LARGE","Допускается изображение до 10 MB");
  const mediaType=sniffImage(buffer);
  const id=randomUUID();
  const objectKey="input/"+id;
  const location=path.join(config().STORAGE_DIR,objectKey);
  await fs.mkdir(path.dirname(location),{recursive:true});
  await fs.writeFile(location,buffer,{flag:"wx",mode:0o600});
  try {
    await db().query("INSERT INTO media_assets(id,user_id,kind,object_key,media_type,byte_size,expires_at) VALUES($1,$2,'input',$3,$4,$5,now()+interval '7 days')",[id,userId,objectKey,mediaType,buffer.length]);
  }catch(error){await fs.unlink(location).catch(()=>{});throw error;}
  return {id,mediaType};
}
export async function inputForQuote(userId:string,id:string):Promise<{buffer:Buffer;mime:string;name:string}> {
  const row=await one<{object_key:string;media_type:string}>(`
    SELECT object_key,media_type FROM media_assets
    WHERE id=$1 AND user_id=$2 AND kind='input' AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now())
  `,[id,userId]);
  assert(row,404,"FILE_NOT_FOUND","Изображение не найдено");
  const content=await fs.readFile(path.join(config().STORAGE_DIR,row.object_key));
  return {buffer:content,mime:row.media_type,name:id+(row.media_type==="image/png"?".png":row.media_type==="image/webp"?".webp":".jpg")};
}
export async function userAsset(userId:string,id:string):Promise<{object_key:string;media_type:string;byte_size:string}> {
  const row=await one<{object_key:string;media_type:string;byte_size:string}>(`
    SELECT object_key,media_type,byte_size FROM media_assets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at>now())
  `,[id,userId]);
  assert(row,404,"FILE_NOT_FOUND","Файл не найден");
  return row;
}
export async function localMedia(key:string):Promise<Buffer> {
  if(!/^(input|output)\/[a-f0-9-]{36}$/.test(key)) throw new HttpError(400,"INVALID_FILE","Некорректный путь к файлу");
  return fs.readFile(path.join(config().STORAGE_DIR,key));
}

export async function persistRecipeAsset(userId: string, body: Buffer): Promise<string> {
  assert(body.length > 0 && body.length <= MAX_OUTPUT, 502, "OUTPUT_TOO_LARGE", "Результат слишком большой");
  const type = sniffImage(body);
  const id = randomUUID();
  const objectKey = `output/${id}`;
  const location = path.join(config().STORAGE_DIR, objectKey);
  await fs.mkdir(path.dirname(location), { recursive: true });
  await fs.writeFile(location, body, { flag: "wx", mode: 0o600 });
  try {
    await db().query(`INSERT INTO media_assets (id,user_id,kind,object_key,media_type,byte_size,expires_at)
      VALUES ($1,$2,'output',$3,$4,$5,now()+$6*interval '1 day')`,
      [id, userId, objectKey, type, body.length, config().OUTPUT_RETENTION_DAYS]);
  } catch (error) {
    // An uncertain insert may have committed. Delete the file only after verifying absence.
    const row = await one("SELECT id FROM media_assets WHERE id=$1", [id]).catch(() => undefined);
    if (row === null) await fs.unlink(location).catch(() => {});
    throw error;
  }
  return id;
}
function validateOutputUrl(raw:string):URL {
  const u=new URL(raw);
  if(u.protocol!=="https:"||u.username||u.password||!u.hostname||u.port) throw new HttpError(502,"UNSAFE_MEDIA_URL","Invalid output URL");
  const host=u.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".local")||host.endsWith(".internal")||isIP(host)||host.endsWith(".localhost"))
    throw new HttpError(502,"UNSAFE_MEDIA_URL","Internal output URL refused");
  // The output URL came from WaveSpeed, but its hostname could still resolve to private
  // infrastructure. Require a per-deployment exact host allowlist in live mode.
  const allowed=config().OUTPUT_HOST_ALLOWLIST.split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(!allowed.includes(host))throw new HttpError(502,"OUTPUT_HOST_NOT_ALLOWED",
    "Host результата не разрешён в OUTPUT_HOST_ALLOWLIST");
  return u;
}
/**
 * Infer real media type from magic bytes. CDN servers frequently label files
 * as application/octet-stream, but we must never serve an arbitrary blob as
 * executable HTML/SVG or silently store an unplayable video.
 */
export function checkedOutputType(body:Buffer, declared:string):string {
  let detected:string|undefined;
  if(body.length>=8&&body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))detected="image/png";
  else if(body.length>=3&&body[0]===255&&body[1]===216&&body[2]===255)detected="image/jpeg";
  else if(body.length>=12&&body.toString("ascii",0,4)==="RIFF"&&body.toString("ascii",8,12)==="WEBP")detected="image/webp";
  else if(body.length>=12&&body.toString("ascii",4,8)==="ftyp")detected="video/mp4";
  else if(body.length>=12&&body.toString("ascii",0,4)==="RIFF"&&body.toString("ascii",8,12)==="WAVE")detected="audio/wav";
  else if(body.length>=3&&body.toString("ascii",0,3)==="ID3")detected="audio/mpeg";
  else if(body.length>=2&&body[0]===255&&(body[1]&0xe0)===0xe0)detected="audio/mpeg";
  if(!detected)throw new HttpError(502,"INVALID_OUTPUT_TYPE","Неизвестный формат результата");
  if(declared!==""&&declared!=="application/octet-stream"&&declared!==detected)
    throw new HttpError(502,"OUTPUT_MIME_MISMATCH","MIME результата не соответствует содержимому");
  return detected;
}
async function remoteBytes(raw:string):Promise<{body:Buffer;type:string}> {
  const url=validateOutputUrl(raw);
  const response=await fetch(url,{signal:AbortSignal.timeout(120000),redirect:"error",cache:"no-store"});
  if(!response.ok||!response.body)throw new HttpError(502,"OUTPUT_DOWNLOAD_FAILED","Результат пока недоступен");
  const contentLength=Number(response.headers.get("content-length"));
  if(contentLength>MAX_OUTPUT){await response.body.cancel();throw new HttpError(502,"OUTPUT_TOO_LARGE","Результат слишком большой");}
  const type=(response.headers.get("content-type")??"").split(";")[0].toLowerCase();
  const chunks:Uint8Array[]=[];
  let total=0;
  const reader=response.body.getReader();
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_OUTPUT)throw new HttpError(502,"OUTPUT_TOO_LARGE","Результат слишком большой");
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const body=Buffer.concat(chunks.map(c=>Buffer.from(c)),total);
  return {body,type:checkedOutputType(body,type)};
}

export async function readProviderImage(url: string): Promise<Buffer> {
  const result = await remoteBytes(url);
  if (!["image/png", "image/jpeg", "image/webp"].includes(result.type)) {
    throw new HttpError(502, "INVALID_OUTPUT_TYPE", "Провайдер вернул неподдерживаемый формат изображения");
  }
  return result.body;
}
export async function persistOutput(userId:string,jobId:string,outputUrl:string,sourceIndex=0):Promise<string> {
  const {body,type}=await remoteBytes(outputUrl);
  const id=randomUUID();
  const key="output/"+id;
  const full=path.join(config().STORAGE_DIR,key);
  await fs.mkdir(path.dirname(full),{recursive:true});
  await fs.writeFile(full,body,{flag:"wx",mode:0o600});
  try {
    await db().query("INSERT INTO media_assets(id,user_id,job_id,kind,object_key,media_type,byte_size,source_index,expires_at) VALUES($1,$2,$3,'output',$4,$5,$6,$7,now()+($8::int * interval '1 day'))",
    [id,userId,jobId,key,type,body.length,sourceIndex,config().OUTPUT_RETENTION_DAYS]);
  }catch(error){await fs.unlink(full).catch(()=>{});throw error;}
  return id;
}
export async function persistMockOutput(userId:string,jobId:string):Promise<string> {
  const id=randomUUID(),key="output/"+id;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#171d37"/><circle cx="512" cy="430" r="210" fill="#a694ff"/><text x="512" y="800" font-family="sans-serif" text-anchor="middle" font-size="48" fill="white">AI Content Maker — MOCK</text></svg>`;
  const body=Buffer.from(svg);
  const full=path.join(config().STORAGE_DIR,key);
  await fs.mkdir(path.dirname(full),{recursive:true});
  await fs.writeFile(full,body,{flag:"wx",mode:0o600});
  await db().query("INSERT INTO media_assets(id,user_id,job_id,kind,object_key,media_type,byte_size,expires_at) VALUES($1,$2,$3,'output',$4,'image/svg+xml',$5,now()+($6::int * interval '1 day'))",
    [id,userId,jobId,key,body.length,config().OUTPUT_RETENTION_DAYS]);
  return id;
}
