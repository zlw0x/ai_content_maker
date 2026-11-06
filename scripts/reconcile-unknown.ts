import {db,one} from "../src/server/db";
import {getPrediction} from "../src/server/wavespeed";

async function main(){
  const action=process.argv[2]??"list";
  if(action==="list"){
    const rows=await db().query(`SELECT id,model_id,provider_prediction_id,created_at,error_code
      FROM generation_jobs WHERE status='unknown' ORDER BY created_at DESC LIMIT 50`);
    console.table(rows.rows);
  }else if(action==="attach"){
    const id=process.argv[3],providerId=process.argv[4];
    if(!id||!providerId||!process.env.OPERATOR_VERIFIED_PROVIDER_HISTORY)
      throw new Error("Usage: OPERATOR_VERIFIED_PROVIDER_HISTORY=1 npm run reconcile -- attach JOB_UUID PREDICTION_ID");
    // Validate prediction exists under our authenticated account. No new paid task is created.
    const prediction=await getPrediction(providerId);
    if(prediction.id!==providerId)throw new Error("Provider prediction id mismatch");
    const changed=await db().query(`UPDATE generation_jobs SET provider_prediction_id=$2,status='processing',
      error_code=NULL,updated_at=now(),last_polled_at=NULL WHERE id=$1 AND status='unknown' RETURNING id`,[id,providerId]);
    if(changed.rowCount!==1)throw new Error("Unknown job not found");
    console.log("Attached existing provider prediction:",providerId);
  }else{
    throw new Error("Usage: npm run reconcile -- list | attach JOB_UUID PREDICTION_ID");
  }
  await db().end();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
