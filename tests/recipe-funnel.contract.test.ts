import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, one } from "../src/server/db";
import { expireRecipeFunnel, parseRecipeFunnelEvent, recipeFunnelDigest, recordRecipeFunnelEvent } from "../src/server/recipe-funnel";
import { recipeOpsReport } from "../src/server/recipe-ops";
import { createRecipeOrder, createRecipeQuote } from "../src/server/recipe-orders";
import { applyMockRecipePayment, startRecipePayment } from "../src/server/recipe-payments";

const databaseUrl = process.env.RECIPE_FUNNEL_TEST_DATABASE_URL;

test("funnel counts deduplicated ordered visits and trusted conversions", { skip: !databaseUrl }, async context => {
  const target = new URL(databaseUrl!);
  assert(["localhost", "127.0.0.1"].includes(target.hostname) && ["/test", "/recipe_test"].includes(target.pathname));
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl, WAVESPEED_MODE: "mock", PAYMENT_MODE: "disabled", ALLOW_LIVE_PAYMENTS: "false",
    RECIPE_FUNNEL_ENABLED: "true", RECIPE_ORDERS_ENABLED: "true", RECIPE_PAYMENT_MODE: "mock",
  });
  const userId = randomUUID();
  const visits = [randomUUID(), randomUUID(), randomUUID()];
  const [visit, outOfOrder, expired] = visits;
  context.after(async () => {
    try {
      await db().query(`DELETE FROM recipe_payment_events WHERE payment_id IN
        (SELECT p.id FROM recipe_payments p JOIN recipe_orders o ON o.id=p.order_id WHERE o.user_id=$1)`, [userId]);
      await db().query("DELETE FROM recipe_payments WHERE order_id IN (SELECT id FROM recipe_orders WHERE user_id=$1)", [userId]);
      await db().query("DELETE FROM recipe_orders WHERE user_id=$1", [userId]);
      await db().query("DELETE FROM recipe_quotes WHERE user_id=$1", [userId]);
      await db().query("DELETE FROM media_assets WHERE user_id=$1", [userId]);
      await db().query("DELETE FROM users WHERE id=$1", [userId]);
      await db().query("DELETE FROM recipe_funnel_events WHERE visit_digest=ANY($1::text[])", [visits.map(recipeFunnelDigest)]);
    } finally { await db().end(); }
  });
  assert.throws(() => parseRecipeFunnelEvent({ visitId: visit, stage: "paid" }));
  assert.throws(() => parseRecipeFunnelEvent({ visitId: visit, stage: "example", email: "private@example.invalid" }));
  assert.equal(recipeFunnelDigest("not-a-uuid"), null);
  const record = async (visitId: string, stage: "example" | "start" | "free_export") => recordRecipeFunnelEvent({ visitId, stage });
  await record(visit, "example");
  await Promise.all([record(visit, "start"), record(visit, "start")]);
  await record(visit, "free_export");
  await record(outOfOrder, "example");
  await record(outOfOrder, "free_export");
  await record(outOfOrder, "start");
  await record(expired, "example");
  assert.equal((await one("SELECT count(*)::int AS total FROM recipe_funnel_events WHERE visit_digest=$1", [recipeFunnelDigest(visit)]))?.total, 3);

  await db().query("INSERT INTO users(id,email) VALUES ($1,$2)", [userId, `${userId}@example.invalid`]);
  const asset = await one<{ id: string }>(`INSERT INTO media_assets(user_id,kind,object_key,media_type,byte_size)
    VALUES($1,'input',$2,'image/png',1) RETURNING id`, [userId, `input/${randomUUID()}`]);
  const input = { recipeKey: "studio-card", assetId: asset!.id, layout: { title: "Кружка" }, access: "premium" };
  await createRecipeQuote(userId, input, visit); // Abandoned quote cannot hide a later conversion.
  const expiredQuote = await createRecipeQuote(userId, input, expired);
  await db().query("UPDATE recipe_quotes SET created_at=now()-interval '31 days' WHERE id=$1", [expiredQuote.id]);
  await db().query("UPDATE recipe_funnel_events SET created_at=now()-interval '31 days' WHERE visit_digest=$1", [recipeFunnelDigest(expired)]);

  async function completedOrder(id: string | null) {
    const quote = await createRecipeQuote(userId, input, id);
    const order = await createRecipeOrder(userId, { quoteId: quote.id }, randomUUID(), "127.0.0.1");
    await startRecipePayment(userId, order.id);
    await applyMockRecipePayment(userId, order.id, "succeeded");
    await applyMockRecipePayment(userId, order.id, "succeeded");
    await db().query("UPDATE recipe_orders SET status='completed',completed_at=clock_timestamp() WHERE id=$1", [order.id]);
    return order.id;
  }
  await completedOrder(visit);
  const repeatOrder = await completedOrder(null); // Repeat is measured on the account, across tabs.
  const { funnel30d } = await recipeOpsReport();
  assert.deepEqual(funnel30d, [{
    waveSpeedMode: "mock", exampleVisits: 2, startedVisits: 2, freeExportVisits: 1, premiumQuoteVisits: 1,
    mockPaidVisits: 1, mockDeliveredVisits: 1, mockRepeatVisits: 1, yookassaTestPaidVisits: 0,
    yookassaTestDeliveredVisits: 0, yookassaTestRepeatVisits: 0,
  }]);
  assert(!JSON.stringify(funnel30d).includes(userId));
  await db().query("UPDATE recipe_orders SET completed_at=now()+interval '31 days' WHERE id=$1", [repeatOrder]);
  assert.equal((await recipeOpsReport()).funnel30d[0].mockRepeatVisits, 0);
  await expireRecipeFunnel();
  assert.equal(await one("SELECT stage FROM recipe_funnel_events WHERE visit_digest=$1", [recipeFunnelDigest(expired)]), null);
  assert.equal((await one("SELECT funnel_digest FROM recipe_quotes WHERE id=$1", [expiredQuote.id]))?.funnel_digest, null);
});
