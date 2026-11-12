import Decimal from "decimal.js";
import { db, transaction } from "./db";
import { settleTrial } from "./recipe-orders";
import { config } from "./config";
import { getPrediction } from "./wavespeed";
import { recipeFunnelReport } from "./recipe-funnel";

const netUsdPattern = /^\d{1,8}(\.\d{1,6})?$/;

export async function recipeOpsReport() {
  const client = await db().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [activity] } = await client.query(`WITH recent AS (
      SELECT o.*, coalesce(t.net_usd, o.provider_actual_usd) AS actual_usd
      FROM recipe_orders o LEFT JOIN recipe_trial_reconciliations t ON t.order_id=o.id
      WHERE o.created_at>=now()-interval '24 hours'
    ) SELECT now() AS "asOf", count(*)::int AS "orders24h",
      (count(*) FILTER (WHERE status='completed'))::int AS "completed24h",
      (count(*) FILTER (WHERE status='failed'))::int AS "failed24h",
      (count(*) FILTER (WHERE status='unknown'))::int AS "unknown24h",
      round(avg(extract(epoch FROM completed_at-created_at)) FILTER (WHERE status='completed'))::int AS "meanTimeToResultSeconds24h",
      coalesce(sum(provider_cost_usd) FILTER (WHERE provider_prediction_id IS NOT NULL),0)::text AS "providerQuotedUsd24h",
      coalesce(sum(actual_usd),0)::text AS "providerActualNetUsd24h",
      count(actual_usd)::int AS "providerReconciledOrders24h",
      (count(*) FILTER (WHERE provider_mode='live' AND actual_usd IS NULL
        AND (provider_prediction_id IS NOT NULL OR error_code='SUBMISSION_UNCERTAIN')))::int AS "providerUnreconciledOrders24h"
      FROM recent`);
    const { rows: [queue] } = await client.query(`SELECT
      (count(*) FILTER (WHERE status='queued'))::int AS queued,
      (count(*) FILTER (WHERE status IN ('preparing','submitting','processing')))::int AS active,
      (count(*) FILTER (WHERE status='unknown'))::int AS unknown,
      round(extract(epoch FROM now()-min(updated_at) FILTER (WHERE status='queued')))::int AS "oldestQueuedSeconds"
      FROM recipe_orders`);
    const { rows: [payments] } = await client.query(`SELECT
      (count(*) FILTER (WHERE p.status='unknown'))::int AS "unknownPayments",
      (count(*) FILTER (WHERE p.refund_status IN ('pending','unknown')))::int AS "openRefunds",
      (count(*) FILTER (WHERE o.status='failed' AND p.status='succeeded' AND p.refund_status IS DISTINCT FROM 'succeeded'))::int AS "failedPaidOrders"
      FROM recipe_payments p JOIN recipe_orders o ON o.id=p.order_id`);
    const { rows: [trial] } = await client.query(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS "utcDay",
      coalesce((SELECT reserved_usd FROM recipe_trial_days WHERE day=(now() AT TIME ZONE 'UTC')::date),0)::text AS "reservedUsd",
      coalesce((SELECT used_usd FROM recipe_trial_days WHERE day=(now() AT TIME ZONE 'UTC')::date),0)::text AS "budgetUsedUsd",
      (SELECT count(*)::int FROM recipe_trial_grants g JOIN recipe_orders o ON o.id=g.order_id
        WHERE g.state='reserved' AND o.status IN ('unknown','failed')) AS "unreconciledGrants"`);
    const funnel30d = await recipeFunnelReport(client);
    await client.query("COMMIT");
    return { activity, queue, payments, trial, funnel30d };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function resumeRecipeResult(orderId: string) {
  const resumed = await db().query(`UPDATE recipe_orders SET status='processing', error_code=NULL,
    poll_deadline_at=now()+interval '15 minutes', last_polled_at=NULL, updated_at=now()
    WHERE id=$1 AND provider_mode='live' AND status='unknown' AND error_code='OUTPUT_RECONCILIATION_TIMEOUT'
      AND provider_prediction_id IS NOT NULL AND attempt_id IS NULL RETURNING id`, [orderId]);
  if (!resumed.rowCount) throw new Error("Нет заказа с известным результатом, который можно повторно запросить");
}

export async function attachRecipeResult(orderId: string, predictionId: string) {
  if (config().WAVESPEED_MODE !== "live" || !/^[a-zA-Z0-9_-]{5,180}$/.test(predictionId)) throw new Error("Нужны live-окружение и точный ID WaveSpeed");
  const match = "id=$1 AND provider_mode='live' AND status='unknown' AND error_code='SUBMISSION_UNCERTAIN' AND provider_prediction_id IS NULL";
  const eligible = await db().query(`SELECT id FROM recipe_orders WHERE ${match}`, [orderId]);
  if (!eligible.rowCount) throw new Error("Заказ не ожидает привязки результата");
  await getPrediction(predictionId, { requireIdMatch: true });
  const attached = await db().query(`UPDATE recipe_orders SET status='processing', error_code=NULL, provider_prediction_id=$2,
    poll_deadline_at=now()+interval '15 minutes', attempt_id=NULL, last_polled_at=NULL, updated_at=now()
    WHERE ${match} RETURNING id`, [orderId, predictionId]);
  if (!attached.rowCount) throw new Error("Заказ изменился во время проверки");
}

export async function reconcileRecipeTrial(orderId: string, value: string) {
  if (!netUsdPattern.test(value)) throw new Error("Укажите сверенное чистое списание в USD, до 6 знаков после точки");
  const net = new Decimal(value);
  return transaction(async client => {
    const { rows: [order] } = await client.query<{ status: string; provider_mode: string }>(
      "SELECT status, provider_mode FROM recipe_orders WHERE id=$1 FOR UPDATE", [orderId]);
    if (!order || order.provider_mode !== "live" || !["failed", "unknown"].includes(order.status)) throw new Error("Заказ не ожидает сверки Trial");
    const { rows: [prior] } = await client.query<{ net_usd: string }>("SELECT net_usd FROM recipe_trial_reconciliations WHERE order_id=$1", [orderId]);
    if (prior) {
      if (!net.eq(prior.net_usd)) throw new Error("Заказ уже сверён на другую сумму");
      return "already reconciled";
    }
    const { rows: [grant] } = await client.query<{ ceiling_usd: string }>(
      "SELECT ceiling_usd FROM recipe_trial_grants WHERE order_id=$1 AND state='reserved' FOR UPDATE", [orderId]);
    if (!grant || net.gt(grant.ceiling_usd)) throw new Error("Сумма превышает резерв или резерв Trial отсутствует");
    await settleTrial(client, orderId, net.gt(0), net.toFixed(6));
    await client.query("INSERT INTO recipe_trial_reconciliations (order_id, net_usd) VALUES ($1,$2)", [orderId, net.toFixed(6)]);
    await client.query("UPDATE recipe_orders SET status='failed', error_code='TRIAL_RECONCILED', updated_at=now() WHERE id=$1", [orderId]);
    return "reconciled";
  });
}

export async function recordRecipeProviderCost(orderId: string, predictionId: string, value: string) {
  if (!netUsdPattern.test(value)) throw new Error("Укажите сверенное чистое списание в USD, до 6 знаков после точки");
  const net = new Decimal(value);
  return transaction(async client => {
    const { rows: [order] } = await client.query<{ provider_actual_usd: string | null }>(`SELECT o.provider_actual_usd
      FROM recipe_orders o JOIN recipe_quotes q ON q.id=o.quote_id
      WHERE o.id=$1 AND o.provider_mode='live' AND o.provider_prediction_id=$2
      AND (o.status='completed' OR (o.status='failed' AND q.access='premium')) FOR UPDATE OF o`, [orderId, predictionId]);
    if (!order) throw new Error("Нет завершённого заказа с указанным ID WaveSpeed. Для сбоя Trial используйте settle-trial");
    if (order.provider_actual_usd !== null) {
      if (!net.eq(order.provider_actual_usd)) throw new Error("Заказ уже сверён на другую сумму");
      return "already reconciled";
    }
    await client.query("UPDATE recipe_orders SET provider_actual_usd=$2, provider_reconciled_at=now() WHERE id=$1",
      [orderId, net.toFixed(6)]);
    return "reconciled";
  });
}
