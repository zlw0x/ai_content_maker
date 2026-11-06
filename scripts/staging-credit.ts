/**
 * Explicit operator-only staging tool. No HTTP endpoint.
 * Use with a CLEAN and isolated staging DB, never a DB containing mock credits.
 */
import {randomUUID} from "node:crypto";
import {config} from "../src/server/config";
import {db,transaction} from "../src/server/db";
import {creditConfirmedPayment} from "../src/server/wallet";

async function main(){
  const c=config();
  if(c.WAVESPEED_MODE!=="live"||c.PAYMENT_MODE!=="disabled"||
    c.DEMO_CREDIT_ENABLED!=="false"||c.STAGING_MANUAL_CREDIT_ENABLED!=="true"){
    throw new Error("Staging manual credit is disabled. Requires WAVESPEED_MODE=live, PAYMENT_MODE=disabled, DEMO_CREDIT_ENABLED=false, STAGING_MANUAL_CREDIT_ENABLED=true.");
  }
  const email=process.argv[2],amount=Number(process.argv[3]);
  if(!email||!Number.isSafeInteger(amount)||amount<1||amount>1000){
    throw new Error("Usage: npm run staging:credit -- person@example.com 500  (kopecks, max 1000)");
  }
  const result=await transaction(async conn=>{
    const user=(await conn.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL FOR UPDATE",[email])).rows[0];
    if(!user)throw new Error("Unknown user");
    // Never credit accounts which have ever received mock (dev) money.
    const demo=(await conn.query("SELECT id FROM payments WHERE user_id=$1 AND provider='dev' LIMIT 1",[user.id])).rows[0];
    if(demo)throw new Error("Mock-funded account: use a fresh staging account and database");
    const existing=(await conn.query<{total:string}>(`SELECT coalesce(sum(amount_kopecks),0) AS total
      FROM payments WHERE user_id=$1 AND provider='staging'`,[user.id])).rows[0];
    if(Number(existing.total)+amount>1000)throw new Error("Total staging credits may not exceed 1000 kopecks per account");
    const paymentId=randomUUID();
    await conn.query(`INSERT INTO payments(id,user_id,client_idempotency_key,amount_kopecks,status,provider,external_payment_id)
      VALUES($1,$2,$3,$4,'succeeded','staging',$5)`,[paymentId,user.id,paymentId,amount,"staging-"+paymentId]);
    await creditConfirmedPayment(conn,paymentId,user.id,amount);
    return {creditedKopecks:amount};
  });
  console.log(result);
  await db().end();
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Unknown error");process.exitCode=1;});
