/**
 * Read-only WaveSpeed probe: validates a rotated key, available provider
 * balance and request-specific pricing without submitting an inference.
 */
import {config} from "../src/server/config";
import {providerBalance,providerPrice} from "../src/server/wavespeed";
import Decimal from "decimal.js";

async function main(){
  const c=config();
  if(c.WAVESPEED_MODE!=="live")throw new Error("Requires WAVESPEED_MODE=live");
  const balance=new Decimal(await providerBalance());
  const input={prompt:"A small copper cube on a neutral background",size:"1024*1024",output_format:"jpeg"};
  const cost=new Decimal(await providerPrice("wavespeed-ai/z-image/turbo",input));
  if(cost.isNegative()||cost.gt(c.MAX_PROVIDER_COST_USD)){
    throw new Error("Provider quoted cost exceeds configured MAX_PROVIDER_COST_USD. No inference submitted.");
  }
  console.log(JSON.stringify({
    provider:"WaveSpeed",model:"wavespeed-ai/z-image/turbo",
    balanceUsd:balance.toString(),quoteUsd:cost.toString(),
    enoughCredit:balance.gte(cost),
    paidInferenceSubmitted:false
  },null,2));
}
main().catch(e=>{console.error("Provider read-only probe failed:",e instanceof Error?e.message:"Unknown error");process.exitCode=1;});
