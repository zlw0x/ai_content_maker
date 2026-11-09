import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { PoolClient } from "pg";
import { recipeCatalog, recipeVersion, type RecipeKey, type RecipeLayout } from "../lib/recipes";
import { config } from "./config";
import { db, one, transaction } from "./db";
import { assert } from "./errors";
import { inputForQuote, localMedia, persistRecipeAsset, readProviderImage, userAsset } from "./media";
import { normalizeRecipeInput, renderRecipe } from "./recipe-render";
import { getRecipeOrder, recipeCostCeilingUsd, recipeLayoutSchema, recipeOrdersEnabled, settleTrial } from "./recipe-orders";
import { getPrediction, providerPrice, submitPrediction, uploadWaveSpeed } from "./wavespeed";

const models = {
  cutout: "wavespeed-ai/image-background-remover",
  upscale: "wavespeed-ai/vosr2/image",
};
const declined = new Set(["PROVIDER_HTTP_400", "PROVIDER_HTTP_401", "PROVIDER_HTTP_402", "PROVIDER_HTTP_403", "PROVIDER_HTTP_422", "PROVIDER_HTTP_429"]);

type Job = {
  id: string; user_id: string; status: "preparing" | "processing"; layout: RecipeLayout;
  asset_id: string; recipe_key: RecipeKey; recipe_version: number; attempt_id: string;
  provider_prediction_id: string | null;
};

async function claim(status: "queued" | "processing"): Promise<Job | null> {
  return transaction(async client => {
    const mode = config().WAVESPEED_MODE;
    if (status === "queued") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recipe-worker:${mode}`]);
      const active = await client.query<{ count: string }>(`SELECT count(*) FROM recipe_orders WHERE provider_mode=$1
        AND status IN ('preparing','submitting','processing')`, [mode]);
      if (Number(active.rows[0].count) >= config().WORKER_CONCURRENCY) return null;
    }
    const { rows: [row] } = await client.query<Job>(`SELECT o.*, q.asset_id, q.recipe_key, q.recipe_version FROM recipe_orders o
      JOIN recipe_quotes q ON q.id=o.quote_id WHERE o.status=$1 AND o.provider_mode=$2
      AND ($1='queued' OR ((o.last_polled_at IS NULL OR o.last_polled_at < now()-interval '5 seconds')
        AND (o.attempt_id IS NULL OR o.last_polled_at < now()-interval '4 minutes')))
      ORDER BY o.last_polled_at NULLS FIRST, o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [status, mode]);
    if (!row) return null;
    row.attempt_id = randomUUID();
    row.status = status === "queued" ? "preparing" : "processing";
    await client.query(`UPDATE recipe_orders SET status=$2, attempt_id=$3, updated_at=now(),
      last_polled_at=CASE WHEN $2='processing' THEN now() ELSE last_polled_at END WHERE id=$1`,
      [row.id, row.status, row.attempt_id]);
    return row;
  });
}

async function fail(job: Job, code: string, charged: boolean | "unreconciled") {
  await transaction(async client => {
    const changed = await client.query(`UPDATE recipe_orders SET status='failed', error_code=$3, attempt_id=NULL, updated_at=now()
      WHERE id=$1 AND attempt_id=$2 AND status IN ('preparing','submitting','processing')`, [job.id, job.attempt_id, code]);
    if (changed.rowCount && charged !== "unreconciled") await settleTrial(client, job.id, charged);
  });
}

async function persistFiles(userId: string, images: { filename: string; body: Buffer }[]) {
  const files: { id: string; filename: string }[] = [];
  for (const image of images) files.push({ id: await persistRecipeAsset(userId, image.body), filename: image.filename });
  return files;
}

async function linkFiles(client: PoolClient, orderId: string, userId: string, revision: number, files: { id: string; filename: string }[]) {
  for (const [slot, file] of files.entries()) {
    await client.query(`INSERT INTO recipe_outputs (order_id, user_id, asset_id, revision, slot, filename)
      VALUES ($1,$2,$3,$4,$5,$6)`, [orderId, userId, file.id, revision, slot, file.filename]);
  }
}

async function publish(job: Job, prepared: Buffer) {
  const images = await renderRecipe(job.recipe_key, prepared, job.layout);
  const preparedAsset = await persistRecipeAsset(job.user_id, prepared);
  const files = await persistFiles(job.user_id, images);
  await transaction(async client => {
    const changed = await client.query(`UPDATE recipe_orders SET status='completed', prepared_asset_id=$4,
      attempt_id=NULL, updated_at=now(), error_code=NULL WHERE id=$1 AND attempt_id=$2 AND status=$3`,
      [job.id, job.attempt_id, job.status, preparedAsset]);
    if (!changed.rowCount) return;
    await linkFiles(client, job.id, job.user_id, 1, files);
    await settleTrial(client, job.id, true);
  });
}

async function prepare(job: Job) {
  if (job.recipe_version !== recipeVersion || !Object.hasOwn(recipeCatalog, job.recipe_key)) {
    await fail(job, "RECIPE_VERSION_UNAVAILABLE", false);
    return;
  }
  const operation = recipeCatalog[job.recipe_key].operation;
  const model = models[operation];
  let request: Record<string, string>;
  let cost: Decimal;
  try {
    const file = await inputForQuote(job.user_id, job.asset_id);
    const source = await normalizeRecipeInput(file.buffer);
    if (config().WAVESPEED_MODE === "mock") {
      await publish(job, source);
      return;
    }
    const image = await uploadWaveSpeed(source, `${job.id}.png`, "image/png");
    request = operation === "upscale" ? { image, target_resolution: "2k", output_format: "png" } : { image };
    cost = new Decimal(await providerPrice(model, request));
    if (cost.gt(recipeCostCeilingUsd) || cost.gt(config().MAX_PROVIDER_COST_USD)) {
      await fail(job, "RECIPE_UPSTREAM_PRICE", false);
      return;
    }
  } catch {
    await fail(job, "RECIPE_PREPARATION_FAILED", false);
    return;
  }
  const claimed = await db().query(`UPDATE recipe_orders SET status='submitting', provider_cost_usd=$3, updated_at=now()
    WHERE id=$1 AND attempt_id=$2 AND status='preparing'`, [job.id, job.attempt_id, cost.toString()]);
  if (!claimed.rowCount) return;
  try {
    const id = await submitPrediction(model, request);
    await db().query(`UPDATE recipe_orders SET status='processing', provider_prediction_id=$3, attempt_id=NULL, submitted_at=now(), updated_at=now()
      WHERE id=$1 AND attempt_id=$2 AND status='submitting'`, [job.id, job.attempt_id, id]);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (declined.has(code)) await fail(job, code, false);
    else await db().query(`UPDATE recipe_orders SET status='unknown', error_code='SUBMISSION_UNCERTAIN',
      attempt_id=NULL, updated_at=now() WHERE id=$1 AND attempt_id=$2 AND status='submitting'`, [job.id, job.attempt_id]);
  }
}

async function poll(job: Job) {
  try {
    if (!job.provider_prediction_id) return;
    const result = await getPrediction(job.provider_prediction_id);
    if (["failed", "cancelled", "canceled", "timeout", "deleted"].includes(result.status)) {
      await fail(job, "RECIPE_PROVIDER_FAILED", "unreconciled");
    } else if (result.status === "completed" && result.outputs.length === 1) {
      const image = await readProviderImage(result.outputs[0]);
      await publish(job, image);
    } else if (result.status === "completed") {
      await fail(job, "RECIPE_PROVIDER_OUTPUT", "unreconciled");
    }
  } finally {
    await db().query("UPDATE recipe_orders SET attempt_id=NULL WHERE id=$1 AND attempt_id=$2 AND status='processing'", [job.id, job.attempt_id]);
  }
}

export async function tickRecipeWorker() {
  const mode = config().WAVESPEED_MODE;
  await db().query(`UPDATE recipe_orders SET status='queued', attempt_id=NULL, updated_at=now()
    WHERE provider_mode=$1 AND status='preparing' AND updated_at<now()-interval '4 minutes'`, [mode]);
  await db().query(`UPDATE recipe_orders SET status='unknown', error_code='SUBMISSION_UNCERTAIN', attempt_id=NULL, updated_at=now()
    WHERE provider_mode=$1 AND status='submitting' AND updated_at<now()-interval '2 minutes'`, [mode]);
  await db().query(`UPDATE recipe_orders SET status='unknown', error_code='OUTPUT_RECONCILIATION_TIMEOUT', attempt_id=NULL, updated_at=now()
    WHERE provider_mode=$1 AND status='processing' AND submitted_at<now()-interval '15 minutes'
    AND (attempt_id IS NULL OR last_polled_at<now()-interval '4 minutes')`, [mode]);
  const processing = await claim("processing");
  if (processing) {
    try { await poll(processing); }
    catch { console.error("Recipe output reconciliation pending", processing.id); }
  }
  if (!recipeOrdersEnabled()) return;
  const queued = await claim("queued");
  if (queued) await prepare(queued);
}

export async function reviseRecipeOrder(userId: string, orderId: string, raw: unknown) {
  const update = z.object({ revision: z.number().int().positive(), layout: recipeLayoutSchema }).strict().safeParse(raw);
  assert(update.success && z.string().uuid().safeParse(orderId).success, 422, "RECIPE_EDIT_INPUT", "Проверьте редакцию и оформление");
  const { revision, layout } = update.data;
  const order = await one<{ recipe_key: RecipeKey; recipe_version: number; prepared_asset_id: string | null;
    unchanged: boolean; revision: number; status: string }>(`SELECT q.recipe_key, q.recipe_version,
    o.prepared_asset_id, o.revision, o.status, o.layout=$3::jsonb AS unchanged FROM recipe_orders o
    JOIN recipe_quotes q ON q.id=o.quote_id WHERE o.user_id=$1 AND o.id=$2`, [userId, orderId, JSON.stringify(layout)]);
  assert(order, 404, "RECIPE_ORDER_NOT_FOUND", "Заказ не найден");
  assert(order.prepared_asset_id && order.status === "completed" && order.revision === revision,
    409, "RECIPE_EDIT_CONFLICT", "Заказ изменился или результат пока недоступен");
  assert(order.recipe_version === recipeVersion && Object.hasOwn(recipeCatalog, order.recipe_key) && !recipeCatalog[order.recipe_key].trial,
    409, "RECIPE_EDIT_UNAVAILABLE", "У этого результата нет редактируемого оформления");
  assert(layout.title, 422, "RECIPE_TITLE", "Введите название товара");
  if (order.unchanged) return getRecipeOrder(userId, orderId);
  const source = await userAsset(userId, order.prepared_asset_id);
  const prepared = await localMedia(source.object_key);
  const files = await persistFiles(userId, await renderRecipe(order.recipe_key, prepared, layout));
  await transaction(async client => {
    const changed = await client.query(`UPDATE recipe_orders SET layout=$4, revision=revision+1, updated_at=now()
      WHERE id=$1 AND user_id=$2 AND revision=$3 AND status='completed'`, [orderId, userId, revision, layout]);
    assert(changed.rowCount, 409, "RECIPE_EDIT_CONFLICT", "Заказ уже изменён. Откройте свежую редакцию");
    await linkFiles(client, orderId, userId, revision + 1, files);
    await client.query(`UPDATE media_assets SET deleted_at=now() WHERE id IN
      (SELECT asset_id FROM recipe_outputs WHERE order_id=$1 AND user_id=$2 AND revision=$3)`, [orderId, userId, revision]);
  });
  return getRecipeOrder(userId, orderId);
}
