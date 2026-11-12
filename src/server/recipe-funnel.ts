import { z } from "zod";
import type { PoolClient } from "pg";
import { config } from "./config";
import { transaction } from "./db";
import { assert } from "./errors";
import { sha256 } from "./security";

const event = z.object({ visitId: z.string().uuid(), stage: z.enum(["example", "start", "free_export"]) }).strict();

export function recipeFunnelEnabled() { return config().RECIPE_FUNNEL_ENABLED === "true"; }

export function recipeFunnelDigest(id: string | null) {
  const parsed = z.string().uuid().safeParse(id);
  if (!recipeFunnelEnabled() || !parsed.success) return null;
  return sha256(`recipe-funnel:${config().WAVESPEED_MODE}:${parsed.data.toLowerCase()}`);
}

export function parseRecipeFunnelEvent(raw: unknown) {
  const parsed = event.safeParse(raw);
  assert(parsed.success, 422, "FUNNEL_EVENT_INVALID", "Событие не поддерживается");
  return parsed.data;
}

export async function recordRecipeFunnelEvent(input: z.infer<typeof event>) {
  const digest = recipeFunnelDigest(input.visitId);
  if (!digest) return;
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('recipe-funnel-budget'))");
    // A global daily cap bounds anonymous writes, even with unique visit IDs.
    await client.query(`INSERT INTO recipe_funnel_events (visit_digest,provider_mode,stage)
      SELECT $1,$2,$3 WHERE (SELECT count(*) FROM recipe_funnel_events
        WHERE created_at >= date_trunc('day',now(),'UTC')) < 6000
      ON CONFLICT DO NOTHING`, [digest, config().WAVESPEED_MODE, input.stage]);
  });
}

export async function expireRecipeFunnel() {
  await transaction(async client => {
    await client.query("DELETE FROM recipe_funnel_events WHERE created_at<now()-interval '30 days'");
    await client.query("UPDATE recipe_quotes SET funnel_digest=NULL WHERE funnel_digest IS NOT NULL AND created_at<now()-interval '30 days'");
  });
}

export async function recipeFunnelReport(client: PoolClient) {
  const { rows } = await client.query(`WITH visits AS (
    SELECT visit_digest,provider_mode,
      min(created_at) FILTER (WHERE stage='example') AS example_at,
      min(created_at) FILTER (WHERE stage='start') AS started_at,
      min(created_at) FILTER (WHERE stage='free_export') AS exported_at
    FROM recipe_funnel_events WHERE created_at>=now()-interval '30 days' GROUP BY visit_digest,provider_mode
  ), converted AS (
    SELECT v.*, q.id AS quote_id, p.mode AS payment_mode, o.completed_at AS delivered_at,
      EXISTS (SELECT 1 FROM recipe_orders repeat_order JOIN recipe_payments repeat_payment ON repeat_payment.order_id=repeat_order.id
        WHERE repeat_order.user_id=o.user_id AND repeat_order.provider_mode=o.provider_mode AND repeat_payment.mode=p.mode
          AND repeat_payment.status='succeeded' AND repeat_order.status='completed' AND repeat_order.id<>o.id
          AND (repeat_order.completed_at,repeat_order.id)>(o.completed_at,o.id)
          AND repeat_order.completed_at<=o.completed_at+interval '30 days') AS repeated
    FROM visits v LEFT JOIN recipe_quotes q ON q.funnel_digest=v.visit_digest AND q.access='premium'
      AND v.started_at>=v.example_at AND v.exported_at>=v.started_at AND q.created_at>=v.exported_at
    LEFT JOIN recipe_orders o ON o.quote_id=q.id AND o.provider_mode=v.provider_mode
    LEFT JOIN recipe_payments p ON p.order_id=o.id AND p.status='succeeded'
  ) SELECT provider_mode AS "waveSpeedMode",
    (count(DISTINCT visit_digest) FILTER (WHERE example_at IS NOT NULL))::int AS "exampleVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE started_at>=example_at))::int AS "startedVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE started_at>=example_at AND exported_at>=started_at))::int AS "freeExportVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE quote_id IS NOT NULL))::int AS "premiumQuoteVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE payment_mode='mock'))::int AS "mockPaidVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE payment_mode='mock' AND delivered_at IS NOT NULL))::int AS "mockDeliveredVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE payment_mode='mock' AND repeated))::int AS "mockRepeatVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE payment_mode='yookassa-test'))::int AS "yookassaTestPaidVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE payment_mode='yookassa-test' AND delivered_at IS NOT NULL))::int AS "yookassaTestDeliveredVisits",
    (count(DISTINCT visit_digest) FILTER (WHERE payment_mode='yookassa-test' AND repeated))::int AS "yookassaTestRepeatVisits"
    FROM converted GROUP BY provider_mode ORDER BY provider_mode`);
  return rows;
}
