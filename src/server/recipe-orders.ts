import type { PoolClient } from "pg";
import { z } from "zod";
import { isRecipeKey, recipeCatalog, recipeVersion, type RecipeKey, type RecipeLayout } from "../lib/recipes";
import { config } from "./config";
import { db, one, transaction } from "./db";
import { assert } from "./errors";
import { sha256 } from "./security";

const uuid = z.string().uuid();
export const recipeCostCeilingUsd = "0.01";
export const recipeLayoutSchema = z.object({
  title: z.string().trim().max(64).default(""),
  benefit: z.string().trim().max(80).default(""),
  price: z.string().trim().max(24).default(""),
  color: z.string().regex(/^#[a-fA-F0-9]{6}$/).toLowerCase().default("#74529f"),
  alignment: z.enum(["left", "center", "right"]).default("left"),
}).strict();

const quoteSchema = z.object({
  recipeKey: z.string().refine(isRecipeKey), assetId: uuid,
  access: z.enum(["trial", "premium"]), layout: recipeLayoutSchema.default({}),
}).strict();

type QuoteRow = {
  id: string; asset_id: string; recipe_key: RecipeKey; recipe_version: number;
  access: "trial" | "premium"; price_kopecks: number; layout: RecipeLayout; expires_at: Date;
};

export function recipeOrdersEnabled() {
  return config().RECIPE_ORDERS_ENABLED === "true";
}

export function requireRecipeOrders() {
  assert(recipeOrdersEnabled(), 503, "RECIPES_DISABLED", "Рецепты временно недоступны");
}

async function lockInput(client: PoolClient, userId: string, assetId: string) {
  const asset = await client.query(`SELECT id FROM media_assets WHERE id=$1 AND user_id=$2 AND kind='input'
    AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR SHARE`, [assetId, userId]);
  assert(asset.rowCount, 404, "FILE_NOT_FOUND", "Изображение не найдено");
}

export async function recipeAvailability(userId: string) {
  const user = await one<{ verified: boolean; grant: "reserved" | "used" | null }>(`SELECT u.email_verified_at IS NOT NULL AS verified,
    g.state AS grant FROM users u LEFT JOIN recipe_trial_grants g ON g.user_id=u.id WHERE u.id=$1`, [userId]);
  return {
    enabled: recipeOrdersEnabled(), trialEnabled: config().RECIPE_TRIAL_ENABLED === "true",
    verified: user?.verified ?? false, trialState: user?.grant ?? "available", mock: config().WAVESPEED_MODE === "mock",
  };
}

export async function createRecipeQuote(userId: string, raw: unknown) {
  requireRecipeOrders();
  const parsed = quoteSchema.safeParse(raw);
  assert(parsed.success, 422, "RECIPE_INPUT", "Проверьте рецепт, исходник и оформление");
  const request = parsed.data;
  const recipe = recipeCatalog[request.recipeKey as RecipeKey];
  if (request.access === "trial") {
    assert(recipe.trial && config().RECIPE_TRIAL_ENABLED === "true", 409, "TRIAL_DISABLED", "Пробная обработка недоступна");
  }
  if (!recipe.trial) assert(request.layout.title, 422, "RECIPE_TITLE", "Введите название товара");
  const price = request.access === "trial" ? 0 : recipe.priceKopecks;
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recipe-quote:${userId}`]);
    const limits = await client.query<{ count: string }>(`SELECT count(*) FROM recipe_quotes
      WHERE user_id=$1 AND created_at>now()-interval '1 hour'`, [userId]);
    assert(Number(limits.rows[0].count) < 30, 429, "RECIPE_QUOTE_LIMIT", "Лимит расчётов на этот час исчерпан");
    await lockInput(client, userId, request.assetId);
    const { rows: [quote] } = await client.query<QuoteRow>(`INSERT INTO recipe_quotes
      (user_id, asset_id, recipe_key, recipe_version, layout, price_kopecks, access)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, expires_at`,
      [userId, request.assetId, request.recipeKey, recipeVersion, request.layout, price, request.access]);
    return { id: quote.id, recipeKey: request.recipeKey, version: recipeVersion, priceKopecks: price, currency: "RUB", expiresAt: quote.expires_at };
  });
}

async function reserveTrial(client: PoolClient, userId: string, orderId: string, ip: string) {
  const { rows: [account] } = await client.query<{ verified: boolean }>(`SELECT email_verified_at IS NOT NULL AS verified
    FROM users WHERE id=$1 AND deleted_at IS NULL FOR NO KEY UPDATE`, [userId]);
  assert(account?.verified, 403, "TRIAL_EMAIL_REQUIRED", "Подтвердите почту для пробной обработки");
  const existing = await client.query("SELECT user_id FROM recipe_trial_grants WHERE user_id=$1", [userId]);
  assert(!existing.rowCount, 409, "TRIAL_ALREADY_USED", "Пробная обработка уже использована или выполняется");
  const { rows: [{ day }] } = await client.query<{ day: string }>("SELECT (now() AT TIME ZONE 'UTC')::date::text AS day");
  const ipDigest = sha256(`trial:${day}:${ip}`);
  await client.query("INSERT INTO recipe_trial_days(day) VALUES ($1) ON CONFLICT DO NOTHING", [day]);
  const reserve = await client.query(`UPDATE recipe_trial_days SET reserved_usd=reserved_usd+$2
    WHERE day=$1 AND reserved_usd+used_usd+$2<=$3 RETURNING day`, [day, recipeCostCeilingUsd, config().RECIPE_TRIAL_DAILY_BUDGET_USD]);
  assert(reserve.rowCount, 429, "TRIAL_DAILY_BUDGET", "Дневной лимит пробных обработок исчерпан");
  const ipUsage = await client.query<{ count: string }>(`SELECT count(*) FROM recipe_trial_grants
    WHERE budget_day=$1 AND ip_digest=$2`, [day, ipDigest]);
  assert(Number(ipUsage.rows[0].count) < 5, 429, "TRIAL_NETWORK_LIMIT", "Слишком много пробных обработок из этой сети");
  await client.query(`INSERT INTO recipe_trial_grants (user_id, order_id, budget_day, ip_digest, state, ceiling_usd)
    VALUES ($1, $2, $3, $4, 'reserved', $5)`, [userId, orderId, day, ipDigest, recipeCostCeilingUsd]);
}

export async function settleTrial(client: PoolClient, orderId: string, used: boolean, actualUsd?: string) {
  const { rows: [grant] } = await client.query<{ budget_day: string; ceiling_usd: string }>(`SELECT budget_day::text, ceiling_usd
    FROM recipe_trial_grants WHERE order_id=$1 AND state='reserved' FOR UPDATE`, [orderId]);
  if (!grant) return;
  await client.query(`UPDATE recipe_trial_days SET reserved_usd=reserved_usd-$2::numeric,
    used_usd=used_usd+$3::numeric WHERE day=$1`, [grant.budget_day, grant.ceiling_usd, used ? actualUsd ?? grant.ceiling_usd : "0"]);
  if (used) await client.query("UPDATE recipe_trial_grants SET state='used' WHERE order_id=$1", [orderId]);
  else await client.query("DELETE FROM recipe_trial_grants WHERE order_id=$1", [orderId]);
}

export async function createRecipeOrder(userId: string, raw: unknown, key: string | null, ip: string) {
  requireRecipeOrders();
  const input = z.object({ quoteId: uuid }).strict().safeParse(raw);
  assert(input.success && key && uuid.safeParse(key).success, 422, "RECIPE_ORDER_INPUT", "Нужны расчёт и Idempotency-Key");
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`recipe-order:${userId}:${key}`]);
    const { rows: [prior] } = await client.query<{ id: string; quote_id: string; status: string }>(`SELECT id, quote_id, status
      FROM recipe_orders WHERE user_id=$1 AND idempotency_key=$2`, [userId, key]);
    if (prior) {
      assert(prior.quote_id === input.data.quoteId, 409, "IDEMPOTENCY_CONFLICT", "Ключ использован для другого заказа");
      return { id: prior.id, status: prior.status };
    }
    const { rows: [quote] } = await client.query<QuoteRow>(`SELECT * FROM recipe_quotes
      WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE`, [input.data.quoteId, userId]);
    assert(quote, 409, "RECIPE_QUOTE_EXPIRED", "Расчёт истёк, запросите новый");
    const used = await client.query("SELECT id FROM recipe_orders WHERE quote_id=$1", [quote.id]);
    assert(!used.rowCount, 409, "RECIPE_QUOTE_USED", "По этому расчёту уже создан заказ");
    await lockInput(client, userId, quote.asset_id);
    const trial = quote.access === "trial";
    if (trial) assert(config().RECIPE_TRIAL_ENABLED === "true", 409, "TRIAL_DISABLED", "Пробная обработка временно недоступна");
    const { rows: [order] } = await client.query<{ id: string; status: string }>(`INSERT INTO recipe_orders
      (user_id, quote_id, idempotency_key, price_kopecks, status, provider_mode, layout)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, status`,
      [userId, quote.id, key, quote.price_kopecks, trial ? "queued" : "awaiting_payment", config().WAVESPEED_MODE, quote.layout]);
    if (trial) await reserveTrial(client, userId, order.id, ip);
    return order;
  });
}

export async function getRecipeOrder(userId: string, orderId: string) {
  assert(uuid.safeParse(orderId).success, 422, "INVALID_ID", "Неверный ID заказа");
  const order = await one(`SELECT o.id, o.status, o.price_kopecks AS "priceKopecks", o.layout, o.revision,
    o.error_code AS "errorCode", o.expires_at AS "expiresAt", q.recipe_key AS "recipeKey", q.recipe_version AS version,
    q.access, o.provider_mode='mock' AS mock
    FROM recipe_orders o JOIN recipe_quotes q ON q.id=o.quote_id WHERE o.id=$1 AND o.user_id=$2`, [orderId, userId]);
  assert(order, 404, "RECIPE_ORDER_NOT_FOUND", "Заказ не найден");
  const files = await db().query<{ id: string; filename: string }>(`SELECT a.id, out.filename FROM recipe_outputs out
    JOIN recipe_orders o ON o.id=out.order_id AND o.revision=out.revision
    JOIN media_assets a ON a.id=out.asset_id AND a.user_id=out.user_id
    WHERE out.order_id=$1 AND out.user_id=$2 AND a.deleted_at IS NULL AND a.expires_at>now() ORDER BY out.slot`, [orderId, userId]);
  return { ...order, files: files.rows.map(file => ({ ...file, url: `/api/v1/assets/${file.id}` })) };
}

export async function listRecipeOrders(userId: string) {
  const { rows } = await db().query<{ id: string; recipeKey: RecipeKey; status: string; layout: RecipeLayout }>(`SELECT
    o.id, q.recipe_key AS "recipeKey", o.status, o.layout FROM recipe_orders o JOIN recipe_quotes q ON q.id=o.quote_id
    WHERE o.user_id=$1 ORDER BY o.created_at DESC, o.id DESC LIMIT 20`, [userId]);
  return rows;
}
