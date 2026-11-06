import {config} from "./config";
import {db,one,transaction} from "./db";
import {submitPrediction,getPrediction} from "./wavespeed";
import {captureOrder,failAndRelease} from "./wallet";
import {persistOutput,persistMockOutput} from "./media";
import {reconcileTopup} from "./operations";
import {promises as fs} from "node:fs";
import path from "node:path";

type Job={id:string;user_id:string;model_id:string;provider_prediction_id:string|null;status:string;input_json:Record<string,unknown>};

async function claimQueued():Promise<Job|null> {
  return transaction(async c=>{
    // This project runs exactly one worker instance. Each task gets at most one submit attempt.
    const r=await c.query<Job>(`SELECT j.id,j.user_id,j.model_id,j.provider_prediction_id,j.status,q.input_json
      FROM generation_jobs j JOIN price_quotes q ON j.quote_id=q.id
      WHERE j.status='queued' ORDER BY j.created_at ASC FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
    if(!r.rows.length)return null;
    const job=r.rows[0];
    await c.query(`UPDATE generation_jobs SET status='submitting',updated_at=now() WHERE id=$1`,[job.id]);
    return job;
  });
}
async function submit(job:Job) {
  try {
    const providerId=await submitPrediction(job.model_id,job.input_json);
    await db().query(`UPDATE generation_jobs SET provider_prediction_id=$2,status='processing',
      submitted_at=now(),updated_at=now() WHERE id=$1 AND status='submitting'`,[job.id,providerId]);
  }catch(error) {
    // Explicit 4xx rejection is safe to release. Lost response / 5xx might have been billed.
    const code=error && typeof error==="object" && "code" in error ? String(error.code) : "";
    if(["PROVIDER_HTTP_400","PROVIDER_HTTP_401","PROVIDER_HTTP_403","PROVIDER_HTTP_429"].includes(code)){
      await failAndRelease(job.id,code);
      return;
    }
    await db().query(`UPDATE generation_jobs SET status='unknown',error_code='SUBMISSION_UNCERTAIN',updated_at=now()
      WHERE id=$1 AND status='submitting'`,[job.id]);
    console.error("Unknown submission",job.id,error instanceof Error?error.message:"unknown");
  }
}
async function pollOne():Promise<Job|null> {
  return transaction(async c=>{
    const r=await c.query<Job>(`SELECT j.id,j.user_id,j.model_id,j.provider_prediction_id,j.status,q.input_json
      FROM generation_jobs j JOIN price_quotes q ON j.quote_id=q.id
      WHERE j.status='processing' AND (j.last_polled_at IS NULL OR j.last_polled_at<now()-interval '5 seconds')
      ORDER BY j.last_polled_at NULLS FIRST,j.created_at ASC FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
    if(!r.rows.length)return null;
    await c.query("UPDATE generation_jobs SET last_polled_at=now() WHERE id=$1",[r.rows[0].id]);
    return r.rows[0];
  });
}
async function finish(job:Job){
  if(!job.provider_prediction_id)return;
  const result=await getPrediction(job.provider_prediction_id);
  if(["failed","cancelled","timeout","deleted"].includes(result.status)){
    await failAndRelease(job.id,"PROVIDER_"+result.status.toUpperCase());
    return;
  }
  if(result.status!=="completed")return;
  const existing=await db().query<{source_index:number}>("SELECT source_index FROM media_assets WHERE job_id=$1 AND kind='output' AND deleted_at IS NULL",[job.id]);
  const stored=new Set(existing.rows.map(r=>r.source_index));
  if(config().WAVESPEED_MODE==="mock"){
    if(!stored.has(0))await persistMockOutput(job.user_id,job.id);
  }else{
    if(result.outputs.length===0||result.outputs.length>4)
      throw new Error("Provider output count outside supported bounds (1-4)");
    for(let index=0;index<result.outputs.length;index++){
      if(stored.has(index))continue;
      await persistOutput(job.user_id,job.id,result.outputs[index],index);
    }
  }
  await captureOrder(job.id);
}
async function reconcilePayments(){
  if(config().PAYMENT_MODE!=="yookassa")return;
  const list=await db().query<{external_payment_id:string}>(`SELECT external_payment_id FROM payments
    WHERE status='pending' AND external_payment_id IS NOT NULL ORDER BY created_at LIMIT 15`);
  for(const item of list.rows){
    try{await reconcileTopup(item.external_payment_id);}catch(e){console.error("Payment reconcile failed",e instanceof Error?e.message:"unknown");}
  }
}
async function expireMedia(){
  const r=await db().query<{id:string;object_key:string}>(`SELECT id,object_key FROM media_assets
    WHERE expires_at<now() AND deleted_at IS NULL ORDER BY expires_at LIMIT 40`);
  for(const row of r.rows){
    try{
      await fs.unlink(path.join(config().STORAGE_DIR,row.object_key)).catch(e=>{if(e.code!=="ENOENT")throw e;});
      await db().query("UPDATE media_assets SET deleted_at=now() WHERE id=$1",[row.id]);
    }catch(error){console.error("Failed media cleanup",row.id,error);}
  }
}
export async function tickWorker():Promise<void> {
  // Submitting older than 2m without provider ID is UNKNOWN, never blindly retried.
  await db().query(`UPDATE generation_jobs SET status='unknown',error_code='WORKER_INTERRUPTED',updated_at=now()
    WHERE status='submitting' AND updated_at<now()-interval '2 minutes'`);
  const c=config();
  const working=await one<{count:string}>(`SELECT count(*) FROM generation_jobs WHERE status IN ('submitting','processing')`);
  const free=Math.max(0,c.WORKER_CONCURRENCY-Number(working?.count??0));
  for(let i=0;i<free;i++){
    const job=await claimQueued();
    if(!job)break;
    await submit(job);
  }
  for(let i=0;i<c.WORKER_CONCURRENCY;i++){
    const job=await pollOne();
    if(!job)break;
    try{await finish(job);}catch(error){console.error("Result reconciliation failed",job.id,error instanceof Error?error.message:"unknown");}
  }
}
export async function runWorker():Promise<void> {
  let stopping=false;
  process.on("SIGTERM",()=>{stopping=true;});
  process.on("SIGINT",()=>{stopping=true;});
  console.log("Worker started",config().WAVESPEED_MODE);
  let lastCleanup=0;
  while(!stopping) {
    try{
      await tickWorker();
      if(Date.now()-lastCleanup>60_000){
        await expireMedia();
        await reconcilePayments();
        await db().query("DELETE FROM sessions WHERE expires_at<now()");
        lastCleanup=Date.now();
      }
    }catch(error){console.error("Worker tick failed",error);}
    await new Promise(resolve=>setTimeout(resolve,config().WORKER_INTERVAL_MS));
  }
  await db().end();
}
