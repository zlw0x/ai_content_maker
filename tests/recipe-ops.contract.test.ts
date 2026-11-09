import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { db, one } from "../src/server/db";
import { persistRecipeAsset } from "../src/server/media";
import { attachRecipeResult, recipeOpsReport, reconcileRecipeTrial, resumeRecipeResult } from "../src/server/recipe-ops";
import { createRecipeOrder, createRecipeQuote } from "../src/server/recipe-orders";
import { tickRecipeWorker } from "../src/server/recipe-worker";

const databaseUrl = process.env.RECIPE_OPS_TEST_DATABASE_URL;

test("recipe operations resume only an existing GET and reconcile Trial once", { skip: !databaseUrl }, async context => {
  const target = new URL(databaseUrl!);
  assert(["localhost", "127.0.0.1"].includes(target.hostname) && ["/test", "/recipe_test"].includes(target.pathname), "Use an isolated loopback test database");
  process.env.DATABASE_URL = databaseUrl;
  process.env.WAVESPEED_MODE = "live";
  process.env.WAVESPEED_API_KEY = "fixture-key-never-transmitted";
  process.env.RECIPE_ORDERS_ENABLED = "true";
  process.env.WORKER_CONCURRENCY = "10";
  process.env.MAX_PROVIDER_COST_USD = "0.01";
  process.env.PAYMENT_MODE = "disabled";
  process.env.ALLOW_LIVE_PAYMENTS = "false";
  const storage = await mkdtemp(path.join(tmpdir(), "sdelano-recipe-ops-"));
  process.env.STORAGE_DIR = storage;
  const inputDir = path.join(storage, "input");
  await mkdir(inputDir);
  const inputs: string[] = [];

  const runId = randomUUID();
  const owners: string[] = [];
  const day = "2099-01-01";
  const prediction = `fixture-${runId}`;
  const recovered = `recovered-${runId}`;
  const submitUrl = "https://api.wavespeed.ai/api/v3/wavespeed-ai/image-background-remover";
  let quoted = 0.02;
  const requests: { method: string; url: string }[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    requests.push({ method: init?.method ?? "GET", url: String(input) });
    const reply = (data: object) => Response.json({ code: 200, data });
    if (String(input).endsWith("/media/uploads")) return reply({ upload: { url: "https://files.example.invalid/upload", method: "PUT" }, download_url: "https://files.example.invalid/input.png" });
    if (String(input) === "https://files.example.invalid/upload") return new Response(null, { status: 200 });
    if (String(input).endsWith("/model/price")) return reply({ discounted_price: quoted, currency: "USD" });
    if (String(input) === submitUrl) throw new TypeError("Simulated lost response after submit");
    const id = [prediction, recovered].find(value => String(input) === `https://api.wavespeed.ai/api/v3/predictions/${value}/result`);
    assert(id);
    return Response.json({ code: 200, data: { id, status: "processing" } });
  });

  context.after(async () => {
    try {
      const { rows: outputs } = await db().query<{ object_key: string }>(
        "SELECT object_key FROM media_assets WHERE user_id=ANY($1::uuid[]) AND kind='output'", [owners]);
      await db().query("DELETE FROM recipe_outputs WHERE user_id=ANY($1::uuid[])", [owners]);
      await db().query("UPDATE recipe_quotes SET source_order_id=NULL WHERE user_id=ANY($1::uuid[]) AND source_order_id IS NOT NULL", [owners]);
      await db().query("DELETE FROM recipe_trial_reconciliations WHERE order_id IN (SELECT id FROM recipe_orders WHERE user_id=ANY($1::uuid[]))", [owners]);
      await db().query("DELETE FROM recipe_trial_grants WHERE user_id=ANY($1::uuid[])", [owners]);
      await db().query("DELETE FROM recipe_orders WHERE user_id=ANY($1::uuid[])", [owners]);
      await db().query("DELETE FROM recipe_quotes WHERE user_id=ANY($1::uuid[])", [owners]);
      await db().query("DELETE FROM media_assets WHERE user_id=ANY($1::uuid[])", [owners]);
      await db().query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
      await db().query("DELETE FROM recipe_trial_days WHERE day=$1", [day]);
      for (const output of outputs) await unlink(path.join(storage, output.object_key));
      if (outputs.length) await rmdir(path.join(storage, "output"));
    } finally {
      await db().end();
      for (const input of inputs) await unlink(input);
      await rmdir(inputDir);
      await rmdir(storage);
    }
  });

  async function createOrder(status: string, error: string | null, providerId: string | null) {
    const owner = randomUUID();
    owners.push(owner);
    await db().query("INSERT INTO users(id,email) VALUES ($1,$2)", [owner, `${owner}@example.invalid`]);
    const key = `input/${randomUUID()}`;
    const png = await readFile("public/examples/product-card/candle.png");
    const asset = await one<{ id: string }>(`INSERT INTO media_assets(user_id,kind,object_key,media_type,byte_size)
      VALUES($1,'input',$2,'image/png',$3) RETURNING id`, [owner, key, png.length]);
    const file = path.join(storage, key);
    await writeFile(file, png);
    inputs.push(file);
    const quote = await one<{ id: string }>(`INSERT INTO recipe_quotes(user_id,asset_id,recipe_key,recipe_version,layout,price_kopecks,access)
      VALUES($1,$2,'remove-background',1,'{}',0,'trial') RETURNING id`, [owner, asset!.id]);
    const order = await one<{ id: string }>(`INSERT INTO recipe_orders(user_id,quote_id,idempotency_key,price_kopecks,status,provider_mode,layout,error_code,provider_prediction_id,submitted_at)
      VALUES($1,$2,$3,0,$4,'live','{}',$5,$6,now()-interval '1 hour') RETURNING id`, [owner, quote!.id, randomUUID(), status, error, providerId]);
    await db().query(`INSERT INTO recipe_trial_grants(user_id,order_id,budget_day,ip_digest,state,ceiling_usd)
      VALUES($1,$2,$3,$4,'reserved',0.01)`, [owner, order!.id, day, "a".repeat(64)]);
    return order!.id;
  }

  await db().query("INSERT INTO recipe_trial_days(day,reserved_usd) VALUES ($1,0.04)", [day]);
  const retry = await createOrder("unknown", "OUTPUT_RECONCILIATION_TIMEOUT", prediction);
  const lost = await createOrder("unknown", "SUBMISSION_UNCERTAIN", null);
  const failed = await createOrder("failed", "RECIPE_PROVIDER_FAILED", `failed-${runId}`);
  const detached = await createOrder("unknown", "SUBMISSION_UNCERTAIN", null);
  const initial = await recipeOpsReport();
  assert.equal(initial.queue.unknown, 3);
  assert.equal(initial.trial.unreconciledGrants, 4);
  assert(!JSON.stringify(initial).includes(runId));

  await assert.rejects(resumeRecipeResult(lost), /Нет заказа/);
  await resumeRecipeResult(retry);
  await assert.rejects(resumeRecipeResult(retry), /Нет заказа/);
  await tickRecipeWorker();
  assert.deepEqual(requests.map(request => request.method), ["GET"]);
  assert.equal((await one("SELECT status FROM recipe_orders WHERE id=$1", [retry]))?.status, "processing");
  await attachRecipeResult(detached, recovered);
  await assert.rejects(attachRecipeResult(detached, prediction), /не ожидает/);
  assert.deepEqual(requests.map(request => request.method), ["GET", "GET"]);
  assert.equal((await one("SELECT provider_prediction_id FROM recipe_orders WHERE id=$1", [detached]))?.provider_prediction_id, recovered);

  await assert.rejects(reconcileRecipeTrial(failed, "0.011"), /превышает резерв/);
  assert.equal(await reconcileRecipeTrial(failed, "0.004"), "reconciled");
  assert.equal(await reconcileRecipeTrial(failed, "0.004000"), "already reconciled");
  await assert.rejects(reconcileRecipeTrial(failed, "0"), /другую сумму/);
  assert.equal(await reconcileRecipeTrial(lost, "0"), "reconciled");
  assert.deepEqual(await one("SELECT reserved_usd,used_usd FROM recipe_trial_days WHERE day=$1", [day]), {
    reserved_usd: "0.020000", used_usd: "0.004000",
  });
  assert.equal((await recipeOpsReport()).trial.unreconciledGrants, 0);

  await db().query("UPDATE recipe_trial_days SET reserved_usd=reserved_usd+0.02 WHERE day=$1", [day]);
  const expensive = await createOrder("queued", null, null);
  await tickRecipeWorker();
  assert.equal(requests.filter(request => request.url === submitUrl).length, 0);
  assert.equal((await one("SELECT error_code FROM recipe_orders WHERE id=$1", [expensive]))?.error_code, "RECIPE_UPSTREAM_PRICE");
  assert.equal(await one("SELECT state FROM recipe_trial_grants WHERE order_id=$1", [expensive]), null);

  quoted = 0.004;
  const uncertain = await createOrder("queued", null, null);
  await tickRecipeWorker();
  await tickRecipeWorker();
  assert.equal(requests.filter(request => request.url === submitUrl && request.method === "POST").length, 1);
  assert.equal((await one("SELECT error_code FROM recipe_orders WHERE id=$1", [uncertain]))?.error_code, "SUBMISSION_UNCERTAIN");
  assert.equal((await one("SELECT state FROM recipe_trial_grants WHERE order_id=$1", [uncertain]))?.state, "reserved");

  const sourceId = await createOrder("completed", null, `completed-${runId}`);
  const owner = owners.at(-1)!;
  const cutout = await persistRecipeAsset(owner, await readFile("public/examples/product-card/candle.png"));
  await db().query(`INSERT INTO recipe_outputs (order_id,user_id,asset_id,revision,slot,filename)
    VALUES ($1,$2,$3,1,0,'remove-background.png')`, [sourceId, owner, cutout]);
  const quote = await createRecipeQuote(owner, {
    recipeKey: "studio-card", sourceOrderId: sourceId, access: "premium", layout: { title: "Свеча" },
  });
  const job = await createRecipeOrder(owner, { quoteId: quote.id }, randomUUID(), "127.0.0.1");
  await db().query("UPDATE recipe_orders SET status='queued' WHERE id=$1", [job.id]);
  await db().query("UPDATE recipe_orders SET last_polled_at=now() WHERE user_id=ANY($1::uuid[]) AND status='processing'", [owners]);
  const beforeReuse = requests.length;
  await tickRecipeWorker();
  assert.equal(requests.length, beforeReuse, "Live-mode cutout reuse must make no provider calls");
  assert.deepEqual(await one(`SELECT status,provider_prediction_id,provider_cost_usd FROM recipe_orders WHERE id=$1`, [job.id]), {
    status: "completed", provider_prediction_id: null, provider_cost_usd: null,
  });
  assert.equal((await one("SELECT count(*)::int AS count FROM recipe_outputs WHERE order_id=$1", [job.id]))?.count, 3);
});
