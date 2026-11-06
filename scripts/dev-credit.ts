import {config} from "../src/server/config";
import {db,transaction} from "../src/server/db";
import {creditConfirmedPayment} from "../src/server/wallet";
import {randomUUID} from "node:crypto";

async function main(){
  if(process.env.NODE_ENV==="production"||config().PAYMENT_MODE!=="disabled"||config().WAVESPEED_MODE!=="mock")
    throw new Error("Dev credit only permitted in mock mode with payments disabled and not production");
  const email=process.argv[2];
  const kopecks=Number(process.argv[3]);
  if(!email||!Number.isSafeInteger(kopecks)||kopecks<100||kopecks>1000000)
    throw new Error("Usage: npm run dev:credit -- user@example.com 50000   (amount in kopecks)");
  const r=await transaction(async c=>{
    const user=(await c.query<{id:string}>("SELECT id FROM users WHERE email=$1",[email])).rows[0];
    if(!user)throw new Error("User not found. Register first.");
    // Ledger supports payment-backed topup only. This CLI creates a synthetic dev payment.
    const id=randomUUID();
    await c.query(`INSERT INTO payments(id,user_id,client_idempotency_key,amount_kopecks,status,provider,external_payment_id)
      VALUES($1,$2,$3,$4,'succeeded','dev',$5)`,[id,user.id,id,kopecks,"dev-"+id]);
    await creditConfirmedPayment(c,id,user.id,kopecks);
    return id;
  });
  console.log("Dev credit operation:",r);
  await db().end();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
