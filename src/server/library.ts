import {z} from "zod";
import {db,transaction} from "./db";
import {assert,HttpError} from "./errors";

const uuid=z.string().uuid();
const filter=z.enum(["all","image","video","audio"]);
const PAGE_SIZE=18;

export type LibraryItem={
  id:string;appSlug:string;status:string;createdAt:string;finishedAt:string|null;
  priceKopecks:number;prompt:string|null;kind:"image"|"video"|"audio";
  output:{id:string;mediaType:string;url:string;viewUrl:string;expiresAt:string|null}|null;
};
type Row={
  id:string;appSlug:string;status:string;createdAt:string;finishedAt:string|null;
  priceKopecks:string;prompt:string|null;kind:"image"|"video"|"audio";
  assetId:string|null;mediaType:string|null;expiresAt:string|null;
};
export function classifyApp(slug:string):"image"|"video"|"audio"{
  if(["photo-to-video","text-to-video"].includes(slug))return "video";
  if(slug==="ai-voiceover")return "audio";
  return "image";
}
export async function listLibrary(userId:string,kindRaw:string|null,pageRaw:string|null){
  const kind=filter.safeParse(kindRaw??"all");
  assert(kind.success,422,"INVALID_FILTER","Неверный фильтр библиотеки");
  const page=pageRaw===null?0:Number(pageRaw);
  assert(Number.isSafeInteger(page)&&page>=0&&page<=500,422,"INVALID_PAGE","Неверная страница");
  const r=await db().query<Row>(`
    SELECT j.id,j.app_slug AS "appSlug",j.status,j.created_at AS "createdAt",
      j.finished_at AS "finishedAt",j.reserved_kopecks AS "priceKopecks",
      coalesce(q.user_input_json->>'prompt',q.user_input_json->>'text') AS prompt,
      CASE WHEN j.app_slug IN ('photo-to-video','text-to-video') THEN 'video'
           WHEN j.app_slug='ai-voiceover' THEN 'audio' ELSE 'image' END AS kind,
      a.id AS "assetId",a.media_type AS "mediaType",a.expires_at AS "expiresAt"
    FROM generation_jobs j JOIN price_quotes q ON q.id=j.quote_id
    LEFT JOIN LATERAL (
      SELECT id,media_type,expires_at FROM media_assets
      WHERE job_id=j.id AND user_id=$1 AND kind='output'
        AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now())
      ORDER BY source_index LIMIT 1
    ) a ON true
    WHERE j.user_id=$1 AND j.hidden_at IS NULL
      AND ($2::text='all' OR
        CASE WHEN j.app_slug IN ('photo-to-video','text-to-video') THEN 'video'
             WHEN j.app_slug='ai-voiceover' THEN 'audio' ELSE 'image' END=$2)
    ORDER BY j.created_at DESC,j.id DESC
    LIMIT $3 OFFSET $4
  `,[userId,kind.data,PAGE_SIZE+1,page*PAGE_SIZE]);
  const hasMore=r.rows.length>PAGE_SIZE;
  const items:LibraryItem[]=r.rows.slice(0,PAGE_SIZE).map(x=>({
    id:x.id,appSlug:x.appSlug,status:x.status,createdAt:x.createdAt,finishedAt:x.finishedAt,
    priceKopecks:Number(x.priceKopecks),prompt:x.prompt,kind:x.kind,
    output:x.assetId?{id:x.assetId,mediaType:x.mediaType!,expiresAt:x.expiresAt,
      url:"/api/v1/assets/"+x.assetId,viewUrl:"/api/v1/assets/"+x.assetId+"?view=1"}:null
  }));
  return {items,hasMore,nextPage:hasMore?page+1:null};
}
export async function hideCompletedJob(userId:string,id:string){
  assert(uuid.safeParse(id).success,422,"INVALID_ID","Неверный ID заказа");
  return transaction(async c=>{
    const result=await c.query<{id:string;status:string}>(`
      SELECT id,status FROM generation_jobs
      WHERE id=$1 AND user_id=$2 AND hidden_at IS NULL FOR UPDATE
    `,[id,userId]);
    const job=result.rows[0];
    assert(job,404,"ORDER_NOT_FOUND","Заказ не найден");
    assert(["completed","failed"].includes(job.status),409,"JOB_ACTIVE",
      "Нельзя удалить задание до подтверждённого завершения или ошибки");
    await c.query("UPDATE generation_jobs SET hidden_at=now(),updated_at=now() WHERE id=$1",[id]);
    await c.query(`UPDATE media_assets SET deleted_at=now()
      WHERE user_id=$1 AND job_id=$2 AND kind='output' AND deleted_at IS NULL`,[userId,id]);
    // Financial and prediction audit records intentionally retained.
    return {deleted:true};
  });
}
