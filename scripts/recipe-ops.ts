import { z } from "zod";
import { db } from "../src/server/db";
import { attachRecipeResult, recipeOpsReport, reconcileRecipeTrial, resumeRecipeResult } from "../src/server/recipe-ops";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "report")) {
    console.log(JSON.stringify(await recipeOpsReport(), null, 2));
    return;
  }
  const [action, orderId, value, confirmation] = args;
  if (!z.string().uuid().safeParse(orderId).success) throw new Error("Укажите UUID заказа");
  if (action === "resume-result" && args.length === 2) {
    await resumeRecipeResult(orderId);
    console.log("Поставлен повторный запрос существующего результата");
  } else if (action === "attach-result" && args.length === 4 && confirmation === "--history-checked") {
    await attachRecipeResult(orderId, value);
    console.log("Привязан существующий результат WaveSpeed");
  } else if (action === "settle-trial" && args.length === 4 && confirmation === "--history-checked") {
    console.log(await reconcileRecipeTrial(orderId, value));
  } else {
    throw new Error("Команды: report | resume-result UUID | attach-result UUID PREDICTION_ID --history-checked | settle-trial UUID NET_USD --history-checked");
  }
}

main().catch(error => {
  console.error(error instanceof Error && !("severity" in error) ? error.message : "Ошибка базы данных");
  process.exitCode = 1;
}).finally(() => db().end());
