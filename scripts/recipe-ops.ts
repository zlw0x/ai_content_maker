import { z } from "zod";
import { db } from "../src/server/db";
import { attachRecipeResult, recipeOpsReport, reconcileRecipeTrial, recordRecipeProviderCost, resumeRecipeResult } from "../src/server/recipe-ops";
import { checkRecipeSandbox, reconcileRecipePayment, reconcileRecipeRefund, verifyRecipeSandbox } from "../src/server/recipe-payments";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "report")) {
    console.log(JSON.stringify(await recipeOpsReport(), null, 2));
    return;
  }
  if (args.length === 1 && args[0] === "check-yookassa-sandbox") {
    console.log(JSON.stringify(await checkRecipeSandbox(), null, 2));
    return;
  }
  const [action, orderId, value, extra, confirmation] = args;
  if (!z.string().uuid().safeParse(orderId).success) throw new Error("Укажите UUID заказа");
  if (action === "resume-result" && args.length === 2) {
    await resumeRecipeResult(orderId);
    console.log("Поставлен повторный запрос существующего результата");
  } else if (action === "attach-result" && args.length === 4 && extra === "--history-checked") {
    await attachRecipeResult(orderId, value);
    console.log("Привязан существующий результат WaveSpeed");
  } else if (action === "settle-trial" && args.length === 4 && extra === "--history-checked") {
    console.log(await reconcileRecipeTrial(orderId, value));
  } else if (action === "record-provider-cost" && args.length === 5 && confirmation === "--history-checked") {
    console.log(await recordRecipeProviderCost(orderId, value, extra));
  } else if (action === "reconcile-payment" && args.length === 4 && extra === "--history-checked") {
    console.log((await reconcileRecipePayment(orderId, value)).status);
  } else if (action === "reconcile-refund" && args.length === 4 && extra === "--history-checked") {
    console.log((await reconcileRecipeRefund(orderId, value)).refundStatus);
  } else if (action === "verify-yookassa-sandbox" && args.length === 4) {
    console.log(JSON.stringify(await verifyRecipeSandbox(orderId, value, extra), null, 2));
  } else {
    throw new Error("Команды: report | resume-result UUID | attach-result UUID PREDICTION_ID --history-checked | settle-trial UUID NET_USD --history-checked | record-provider-cost UUID PREDICTION_ID NET_USD --history-checked | reconcile-payment UUID PAYMENT_ID --history-checked | reconcile-refund UUID REFUND_ID --history-checked | check-yookassa-sandbox | verify-yookassa-sandbox DELIVERED_UUID CANCELED_UUID REFUNDED_UUID");
  }
}

main().catch(error => {
  console.error(error instanceof Error && !("severity" in error) ? error.message : "Ошибка базы данных");
  process.exitCode = 1;
}).finally(() => db().end());
