import type {PoolClient} from "pg";
import {transaction,one} from "./db";
import {HttpError} from "./errors";

type AmountRow={available_kopecks:string;reserved_kopecks:string};
export function asKopecks(n:unknown):number {
  const amount=Number(n);
  if(!Number.isSafeInteger(amount)||amount<=0)throw new HttpError(422,"INVALID_AMOUNT","Некорректная сумма в копейках");
  return amount;
}
export async function getWallet(userId:string):Promise<{availableKopecks:number;reservedKopecks:number}> {
  const row=await one<AmountRow>("SELECT available_kopecks,reserved_kopecks FROM wallet_accounts WHERE user_id=$1",[userId]);
  if(!row)throw new HttpError(500,"WALLET_MISSING","Кошелёк не найден");
  return {availableKopecks:Number(row.available_kopecks),reservedKopecks:Number(row.reserved_kopecks)};
}
async function ledger(client:PoolClient,userId:string,eventKey:string,kind:string,deltaAvailable:number,deltaReserved:number,paymentId:string|null,jobId:string|null) {
  await client.query(`INSERT INTO wallet_ledger(user_id,event_key,kind,delta_available_kopecks,delta_reserved_kopecks,payment_id,job_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[userId,eventKey,kind,deltaAvailable,deltaReserved,paymentId,jobId]);
}
export async function creditConfirmedPayment(client:PoolClient,paymentId:string,userId:string,amount:number):Promise<boolean> {
  // Single transaction + locked payment row via caller. Unique event key is a second line of defense.
  const credit=await client.query(`INSERT INTO wallet_ledger(user_id,event_key,kind,delta_available_kopecks,payment_id)
    VALUES($1,$2,'topup',$3,$4) ON CONFLICT(user_id,event_key) DO NOTHING RETURNING id`,[userId,"topup:"+paymentId,amount,paymentId]);
  if(credit.rowCount===0)return false;
  const updated=await client.query("UPDATE wallet_accounts SET available_kopecks=available_kopecks+$2,version=version+1,updated_at=now() WHERE user_id=$1",[userId,amount]);
  if(updated.rowCount!==1)throw new HttpError(500,"WALLET_INVARIANT","Не удалось зачислить платёж");
  return true;
}
export async function reserveForOrder(client:PoolClient,userId:string,jobId:string,amount:number):Promise<void> {
  const updated=await client.query(`UPDATE wallet_accounts SET available_kopecks=available_kopecks-$2,reserved_kopecks=reserved_kopecks+$2,version=version+1,updated_at=now()
    WHERE user_id=$1 AND available_kopecks >= $2 RETURNING user_id`,[userId,amount]);
  if(updated.rowCount!==1)throw new HttpError(409,"INSUFFICIENT_FUNDS","Недостаточно средств");
  await ledger(client,userId,"reserve:"+jobId,"reserve",-amount,amount,null,jobId);
}
export async function captureOrder(jobId:string):Promise<boolean> {
  return transaction(async c=>{
    const result=await c.query<{user_id:string;reserved_kopecks:string;status:string}>(`SELECT user_id,reserved_kopecks,status FROM generation_jobs WHERE id=$1 FOR UPDATE`,[jobId]);
    const job=result.rows[0]; if(!job||job.status!=="processing")return false;
    const amount=Number(job.reserved_kopecks);
    const updated=await c.query(`UPDATE wallet_accounts SET reserved_kopecks=reserved_kopecks-$2,version=version+1,updated_at=now() WHERE user_id=$1 AND reserved_kopecks>=$2`,[job.user_id,amount]);
    if(updated.rowCount!==1)throw new HttpError(500,"WALLET_INVARIANT","Несогласованное состояние резерва");
    await ledger(c,job.user_id,"capture:"+jobId,"capture",0,-amount,null,jobId);
    await c.query("UPDATE generation_jobs SET status='completed',finished_at=now(),updated_at=now() WHERE id=$1",[jobId]);
    return true;
  });
}
export async function failAndRelease(jobId:string, reason:string):Promise<boolean> {
  return transaction(async c=>{
    const result=await c.query<{user_id:string;reserved_kopecks:string;status:string}>(`SELECT user_id,reserved_kopecks,status FROM generation_jobs WHERE id=$1 FOR UPDATE`,[jobId]);
    const job=result.rows[0]; if(!job||["completed","failed","unknown"].includes(job.status))return false;
    const amount=Number(job.reserved_kopecks);
    const updated=await c.query(`UPDATE wallet_accounts SET available_kopecks=available_kopecks+$2,reserved_kopecks=reserved_kopecks-$2,version=version+1,updated_at=now()
      WHERE user_id=$1 AND reserved_kopecks >= $2`,[job.user_id,amount]);
    if(updated.rowCount!==1)throw new HttpError(500,"WALLET_INVARIANT","Несогласованное состояние резерва");
    await ledger(c,job.user_id,"release:"+jobId,"release",amount,-amount,null,jobId);
    await c.query("UPDATE generation_jobs SET status='failed',error_code=$2,finished_at=now(),updated_at=now() WHERE id=$1",[jobId,reason.slice(0,128)]);
    return true;
  });
}
