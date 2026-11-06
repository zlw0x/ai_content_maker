import {randomUUID} from "node:crypto";
import {z} from "zod";
import {config} from "./config";
import {db,one,transaction} from "./db";
import {HttpError,assert} from "./errors";
import {hashPassword,verifyPassword,beginSession,rateLimit,recordFailure,sha256} from "./security";
import {prepareApp} from "./model-apps";
import {inputForQuote} from "./media";
import {providerPrice,uploadWaveSpeed} from "./wavespeed";
import {inputDigest,quoteKopecks} from "./pricing";
import {getWallet,reserveForOrder,creditConfirmedPayment} from "./wallet";
import {createSbpPayment,verifySbpPayment,amountInKopecks} from "./yookassa";
import type {Payment} from "./yookassa";

const credentials=z.object({
  email:z.string().trim().toLowerCase().email().max(254),
  password:z.string().min(12).max(128)
});
const idem=z.string().uuid();
const uuid=z.string().uuid();
const topupSchema=z.object({amountKopecks:z.number().int().min(19900).max(1000000)});

export async function register(raw:unknown) {
  const value=credentials.safeParse(raw);
  assert(value.success,422,"INVALID_CREDENTIALS","Нужны email и пароль длиной от 12 символов");
  const userId=randomUUID();
  const passwordHash=await hashPassword(value.data.password);
  try {
    await transaction(async c=>{
      await c.query("INSERT INTO users(id,email) VALUES($1,$2)",[userId,value.data.email]);
      await c.query("INSERT INTO user_credentials(user_id,password_scrypt) VALUES($1,$2)",[userId,passwordHash]);
      await c.query("INSERT INTO wallet_accounts(user_id) VALUES($1)",[userId]);
    });
  }catch(e) {
    if((e as {code?:string}).code==="23505")throw new HttpError(409,"ACCOUNT_EXISTS","Аккаунт уже зарегистрирован");
    throw e;
  }
  await beginSession(userId);
  return {id:userId,email:value.data.email};
}
export async function login(raw:unknown,ip:string) {
  const value=credentials.safeParse(raw);
  assert(value.success,422,"INVALID_CREDENTIALS","Неверный email или пароль");
  const key="login:"+value.data.email;
  await rateLimit(key,5);
  await rateLimit("ip:"+ip,30);
  const user=await one<{id:string;email:string;password_scrypt:string}>(`
    SELECT u.id,u.email,c.password_scrypt FROM users u JOIN user_credentials c ON c.user_id=u.id
    WHERE u.email=$1 AND u.deleted_at IS NULL`,[value.data.email]);
  const correct=user?await verifyPassword(value.data.password,user.password_scrypt):false;
  if(!correct){
    await recordFailure(key);await recordFailure("ip:"+ip);
    throw new HttpError(401,"INVALID_CREDENTIALS","Неверный email или пароль");
  }
  await db().query("DELETE FROM auth_attempts WHERE key_digest=$1",[sha256(key)]);
  await beginSession(user!.id);
  return {id:user!.id,email:user!.email};
}
export async function createQuote(userId:string,raw:unknown) {
  const request=z.object({appSlug:z.string().max(80),input:z.record(z.unknown())}).safeParse(raw);
  assert(request.success,422,"INVALID_INPUT","Неверный запрос");
  const prepared=prepareApp(request.data.appSlug,request.data.input);
  const limits=await one<{count:string}>(`SELECT count(*) FROM price_quotes WHERE user_id=$1 AND created_at>now()-interval '1 day'`,[userId]);
  assert(Number(limits?.count??0)<60,429,"QUOTE_LIMIT","Дневной лимит расчётов исчерпан");
  let url:string|undefined;
  if(prepared.imageAssetId){
    const file=await inputForQuote(userId,prepared.imageAssetId);
    url=await uploadWaveSpeed(file.buffer,file.name,file.mime);
  }
  const providerInput=prepared.spec.build(prepared.input,url);
  const costUsd=await providerPrice(prepared.modelId,providerInput);
  const amount=quoteKopecks(costUsd);
  const id=randomUUID();
  const digest=inputDigest(providerInput);
  await db().query(`INSERT INTO price_quotes
    (id,user_id,app_slug,model_id,input_digest,input_json,input_asset_id,amount_kopecks,provider_cost_usd,fx_rub_per_usd,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '10 minutes')`,
    [id,userId,request.data.appSlug,prepared.modelId,digest,JSON.stringify(providerInput),prepared.imageAssetId??null,amount,costUsd,config().FX_RUB_PER_USD]);
  return {id,appSlug:request.data.appSlug,amountKopecks:amount,currency:"RUB",providerCostUsd:costUsd,expiresInSeconds:600};
}
export async function createOrder(userId:string,raw:unknown,rawIdem:string|null) {
  const body=z.object({quoteId:uuid}).safeParse(raw);
  assert(body.success&&rawIdem&&idem.safeParse(rawIdem).success,422,"INVALID_ORDER","Нужны quoteId и Idempotency-Key UUID");
  return transaction(async c=>{
    // Serialize identical user idempotency keys before querying existing orders.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[userId+":"+rawIdem]);
    const existing=await c.query(`SELECT id,status,reserved_kopecks,quote_id FROM generation_jobs
      WHERE user_id=$1 AND client_idempotency_key=$2`,[userId,rawIdem]);
    if(existing.rowCount) {
      assert(existing.rows[0].quote_id===body.data.quoteId,409,"IDEMPOTENCY_CONFLICT","Ключ использован для другого заказа");
      return {id:existing.rows[0].id,status:existing.rows[0].status,priceKopecks:Number(existing.rows[0].reserved_kopecks),idempotent:true};
    }
    const quote=(await c.query<{id:string;app_slug:string;model_id:string;input_json:unknown;amount_kopecks:string}>(`
      SELECT id,app_slug,model_id,input_json,amount_kopecks FROM price_quotes
      WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE`,[body.data.quoteId,userId])).rows[0];
    assert(quote&&quote.input_json,409,"QUOTE_EXPIRED","Расчёт цены истёк, запросите новый");
    if(config().WAVESPEED_MODE==="live"){
      // Refuse to spend a previously minted demo balance on real provider calls.
      const demo=await c.query("SELECT id FROM payments WHERE user_id=$1 AND provider='dev' LIMIT 1",[userId]);
      assert(!demo.rowCount,409,"DEMO_FUNDS_NOT_VALID","Используйте отдельный аккаунт и базу для реальных операций");
    }
    const used=await c.query("SELECT id FROM generation_jobs WHERE quote_id=$1 LIMIT 1",[quote.id]);
    assert(!used.rowCount,409,"QUOTE_ALREADY_USED","Расчёт цены уже использован");
    const sum=(await c.query<{spent:string}>(`SELECT coalesce(sum(reserved_kopecks),0) AS spent FROM generation_jobs
      WHERE user_id=$1 AND created_at >= current_date`,[userId])).rows[0];
    const amount=Number(quote.amount_kopecks);
    assert(Number(sum.spent)+amount<=config().MAX_DAILY_SPEND_KOPECKS,429,"DAILY_BUDGET","Превышен дневной лимит расходов");
    const id=randomUUID();
    await c.query(`INSERT INTO generation_jobs(id,user_id,quote_id,app_slug,model_id,client_idempotency_key,status,reserved_kopecks)
      VALUES($1,$2,$3,$4,$5,$6,'reserved',$7)`,[id,userId,quote.id,quote.app_slug,quote.model_id,rawIdem,amount]);
    await reserveForOrder(c,userId,id,amount);
    await c.query("UPDATE generation_jobs SET status='queued',updated_at=now() WHERE id=$1",[id]);
    return {id,status:"queued",priceKopecks:amount,idempotent:false};
  });
}
export async function listOrders(userId:string) {
  const result=await db().query(`SELECT id,app_slug AS "appSlug",status,reserved_kopecks AS "priceKopecks",created_at AS "createdAt",
    finished_at AS "finishedAt",error_code AS "errorCode" FROM generation_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,[userId]);
  return result.rows.map(r=>({...r,priceKopecks:Number(r.priceKopecks)}));
}
export async function getOrder(userId:string,id:string) {
  assert(uuid.safeParse(id).success,422,"INVALID_ID","Неверный ID");
  const job=await one(`SELECT id,app_slug AS "appSlug",status,reserved_kopecks AS "priceKopecks",created_at AS "createdAt",
    finished_at AS "finishedAt",error_code AS "errorCode" FROM generation_jobs WHERE user_id=$1 AND id=$2`,[userId,id]);
  assert(job,404,"ORDER_NOT_FOUND","Заказ не найден");
  const assets=await db().query("SELECT id,media_type AS \"mediaType\" FROM media_assets WHERE user_id=$1 AND job_id=$2 AND kind='output' AND deleted_at IS NULL",[userId,id]);
  return {...job,priceKopecks:Number(job.priceKopecks),outputs:assets.rows.map(r=>({...r,url:"/api/v1/assets/"+r.id}))};
}
export async function getUserWallet(userId:string){return getWallet(userId);}

export async function createTopup(userId:string,raw:unknown,idempotencyKey:string|null) {
  if(config().PAYMENT_MODE!=="yookassa")throw new HttpError(503,"PAYMENTS_DISABLED","Реальные платежи отключены");
  const val=topupSchema.safeParse(raw);
  assert(val.success&&idempotencyKey&&idem.safeParse(idempotencyKey).success,422,"INVALID_TOPUP","Сумма 199–10000 ₽ и Idempotency-Key UUID обязательны");
  const paymentId=await transaction(async c=>{
    const existing=await c.query("SELECT id,amount_kopecks FROM payments WHERE user_id=$1 AND client_idempotency_key=$2",[userId,idempotencyKey]);
    if(existing.rowCount) {
      assert(Number(existing.rows[0].amount_kopecks)===val.data.amountKopecks,409,"IDEMPOTENCY_CONFLICT","Ключ уже использован с другой суммой");
      return String(existing.rows[0].id);
    }
    const id=randomUUID();
    await c.query("INSERT INTO payments(id,user_id,client_idempotency_key,amount_kopecks) VALUES($1,$2,$3,$4)",[id,userId,idempotencyKey,val.data.amountKopecks]);
    return id;
  });
  const row=await one<{external_payment_id:string|null;confirmation_url:string|null;amount_kopecks:string;status:string}>("SELECT external_payment_id,confirmation_url,amount_kopecks,status FROM payments WHERE id=$1 AND user_id=$2",[paymentId,userId]);
  assert(row,404,"PAYMENT_NOT_FOUND","Платёж не найден");
  if(row.external_payment_id) return {id:paymentId,status:row.status,confirmationUrl:row.confirmation_url};
  // Claim the creation operation before calling an external money API.
  // If the process dies or the network drops, status remains 'unknown'; never create a second payment blindly.
  const claimed=await db().query(`UPDATE payments SET status='unknown',updated_at=now()
    WHERE id=$1 AND status='pending' AND external_payment_id IS NULL RETURNING id`,[paymentId]);
  assert(claimed.rowCount===1,409,"PAYMENT_UNCERTAIN","Создание платежа требует сверки");
  const external=await createSbpPayment(paymentId,Number(row.amount_kopecks));
  await db().query(`UPDATE payments SET external_payment_id=$2,confirmation_url=$3,status=$4,updated_at=now()
    WHERE id=$1 AND status='unknown' AND external_payment_id IS NULL`,
    [paymentId,external.id,external.confirmation?.confirmation_url??null,external.status==="succeeded"?"pending":external.status]);
  return {id:paymentId,status:external.status,confirmationUrl:external.confirmation?.confirmation_url??null};
}
export async function getTopup(userId:string,id:string) {
  assert(uuid.safeParse(id).success,422,"INVALID_ID","Неверный ID");
  const row=await one(`SELECT id,status,amount_kopecks AS "amountKopecks",confirmation_url AS "confirmationUrl",created_at AS "createdAt"
    FROM payments WHERE id=$1 AND user_id=$2`,[id,userId]);
  assert(row,404,"PAYMENT_NOT_FOUND","Платёж не найден");
  return {...row,amountKopecks:Number(row.amountKopecks)};
}
export async function reconcileTopup(externalId:string):Promise<boolean> {
  const verified=await verifySbpPayment(externalId);
  return transaction(async c=>{
    const payment=(await c.query<{id:string;user_id:string;amount_kopecks:string;status:string}>(`
      SELECT id,user_id,amount_kopecks,status FROM payments WHERE external_payment_id=$1 AND provider='yookassa' FOR UPDATE`,[externalId])).rows[0];
    if(!payment) return false;
    const expected=Number(payment.amount_kopecks);
    if(verified.metadata?.payment_id!==payment.id || amountInKopecks(verified)!==expected)
      throw new HttpError(409,"PAYMENT_MISMATCH","Платёж требует сверки");
    if(verified.status==="succeeded"&&verified.paid){
      if(payment.status!=="succeeded"){
        const {creditConfirmedPayment}=await import("./wallet");
        await creditConfirmedPayment(c,payment.id,payment.user_id,expected);
        await c.query("UPDATE payments SET status='succeeded',updated_at=now() WHERE id=$1",[payment.id]);
      }
    }else if(verified.status==="canceled"&&payment.status!=="succeeded"){
      await c.query("UPDATE payments SET status='canceled',updated_at=now() WHERE id=$1",[payment.id]);
    }
    return true;
  });
}

/**
 * Creates a one-time synthetic credit only when both external providers are disabled.
 * Never enable this endpoint against a DB that will later handle real payments.
 */
export async function grantDemoCredit(userId:string){
  const c=config();
  assert(c.DEMO_CREDIT_ENABLED==="true"&&c.WAVESPEED_MODE==="mock"&&c.PAYMENT_MODE==="disabled",
    403,"DEMO_DISABLED","Тестовое пополнение недоступно");
  return transaction(async dbClient=>{
    await dbClient.query("SELECT pg_advisory_xact_lock(hashtext($1))",[userId+":demo-credit-v1"]);
    const old=await dbClient.query("SELECT id FROM payments WHERE user_id=$1 AND provider='dev' AND client_idempotency_key='demo-credit-v1'",[userId]);
    if(old.rowCount)return {credited:false,amountKopecks:0};
    const id=randomUUID();
    await dbClient.query(`INSERT INTO payments(id,user_id,client_idempotency_key,amount_kopecks,status,provider,external_payment_id)
      VALUES($1,$2,'demo-credit-v1',50000,'succeeded','dev',$3)`,[id,userId,"dev-"+id]);
    await creditConfirmedPayment(dbClient,id,userId,50000);
    return {credited:true,amountKopecks:50000};
  });
}
