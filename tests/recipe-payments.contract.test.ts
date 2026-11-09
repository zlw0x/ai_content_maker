import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, one } from "../src/server/db";
import { HttpError } from "../src/server/errors";
import {
  applyMockRecipePayment,
  applyRecipePaymentEvent,
  applyRecipeRefundEvent,
  getRecipePayment,
  requestRecipeRefund,
  startRecipePayment,
} from "../src/server/recipe-payments";

const databaseUrl = process.env.RECIPE_PAYMENT_TEST_DATABASE_URL;
const failure = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code;

test("Recipe checkout contracts against an isolated, migrated PostgreSQL database", { skip: !databaseUrl }, async context => {
  process.env.DATABASE_URL = databaseUrl!;
  process.env.APP_ORIGIN = "http://127.0.0.1:3000";
  process.env.WAVESPEED_MODE = "mock";
  process.env.PAYMENT_MODE = "disabled";
  process.env.ALLOW_LIVE_PAYMENTS = "false";
  process.env.YOOKASSA_TEST_SHOP_ID = "123456";
  process.env.YOOKASSA_TEST_SECRET_KEY = "test_fixture";

  const owner = randomUUID();
  const other = randomUUID();
  const asset = randomUUID();
  const newOrder = async (mode = "mock") => {
    const quote = await one<{ id: string }>(`INSERT INTO recipe_quotes
      (user_id,asset_id,recipe_key,recipe_version,layout,price_kopecks,access)
      VALUES($1,$2,'product-card',1,'{}',2900,'premium') RETURNING id`, [owner, asset]);
    assert.ok(quote);
    const order = await one<{ id: string }>(`INSERT INTO recipe_orders
      (user_id,quote_id,idempotency_key,price_kopecks,status,provider_mode,layout)
      VALUES($1,$2,$3,2900,'awaiting_payment',$4,'{}') RETURNING id`, [owner, quote.id, randomUUID(), mode]);
    assert.ok(order);
    return order.id;
  };
  const orderStatus = async (order: string) => (await one<{ status: string }>(
    "SELECT status FROM recipe_orders WHERE id=$1", [order]))?.status;

  context.after(async () => {
    try {
      await db().query(`DELETE FROM recipe_payment_events WHERE payment_id IN
        (SELECT p.id FROM recipe_payments p JOIN recipe_orders o ON o.id=p.order_id WHERE o.user_id=$1)`, [owner]);
      await db().query("DELETE FROM recipe_payments WHERE order_id IN (SELECT id FROM recipe_orders WHERE user_id=$1)", [owner]);
      await db().query("DELETE FROM recipe_orders WHERE user_id=$1", [owner]);
      await db().query("DELETE FROM recipe_quotes WHERE user_id=$1", [owner]);
      await db().query("DELETE FROM media_assets WHERE id=$1", [asset]);
      await db().query("DELETE FROM users WHERE id IN ($1,$2)", [owner, other]);
    } finally {
      await db().end();
    }
  });
  await db().query("INSERT INTO users(id,email) VALUES ($1,$3),($2,$4)",
    [owner, other, owner + "@example.invalid", other + "@example.invalid"]);
  await db().query(`INSERT INTO media_assets(id,user_id,kind,object_key,media_type,byte_size)
    VALUES($1::uuid,$2,'input',$1::uuid::text,'image/png',1)`, [asset, owner]);

  await context.test("mock checkout is owner-only, single-attempt, and refundable after confirmed failure", async () => {
    process.env.RECIPE_PAYMENT_MODE = "mock";
    const order = await newOrder();
    await assert.rejects(startRecipePayment(other, order), failure("RECIPE_ORDER_NOT_FOUND"));
    await assert.rejects(startRecipePayment(owner, await newOrder("live")), failure("RECIPE_NOT_PAYABLE"));
    const expired = await newOrder();
    await db().query("UPDATE recipe_orders SET expires_at=now() - interval '1 minute' WHERE id=$1", [expired]);
    await assert.rejects(startRecipePayment(owner, expired), failure("RECIPE_NOT_PAYABLE"));

    const [first, repeat] = await Promise.all([startRecipePayment(owner, order), startRecipePayment(owner, order)]);
    assert.equal(first.status, "pending");
    assert.equal(first.amountKopecks, 2900);
    assert.deepEqual(first, repeat);
    assert.equal(await getRecipePayment(other, order), null);
    assert.equal(await orderStatus(order), "awaiting_payment");

    const [paid, duplicate] = await Promise.all([
      applyMockRecipePayment(owner, order, "succeeded"), applyMockRecipePayment(owner, order, "succeeded"),
    ]);
    assert.equal(paid.status, "succeeded");
    assert.deepEqual(paid, duplicate);
    assert.equal(await orderStatus(order), "queued");
    assert.equal((await applyMockRecipePayment(owner, order, "canceled")).status, "succeeded");
    await assert.rejects(requestRecipeRefund(owner, order), failure("RECIPE_REFUND_UNAVAILABLE"));

    await db().query("UPDATE recipe_orders SET status='failed' WHERE id=$1", [order]);
    const [refund, repeatRefund] = await Promise.all([requestRecipeRefund(owner, order), requestRecipeRefund(owner, order)]);
    assert.equal(refund.refundStatus, "succeeded");
    assert.deepEqual(refund, repeatRefund);
    const events = await db().query<{ kind: string; status: string }>(
      "SELECT kind,status FROM recipe_payment_events WHERE payment_id=$1 ORDER BY kind,status", [first.id]);
    assert.deepEqual(events.rows, [
      { kind: "payment", status: "pending" }, { kind: "payment", status: "succeeded" },
      { kind: "refund", status: "succeeded" },
    ]);

    const canceled = await newOrder();
    await startRecipePayment(owner, canceled);
    assert.equal((await applyMockRecipePayment(owner, canceled, "canceled")).status, "canceled");
    assert.equal((await applyMockRecipePayment(owner, canceled, "succeeded")).status, "canceled");
    assert.equal(await orderStatus(canceled), "awaiting_payment");
  });

  await context.test("YooKassa test shop validates amounts and recovers lost create responses without replay", async subtest => {
    process.env.RECIPE_PAYMENT_MODE = "yookassa-test";
    const order = await newOrder();
    const paymentExternalId = "payment-fixture-1";
    const refundExternalId = "refund-fixture-1";
    const root = "https://api.yookassa.ru/v3";
    const amount = { value: "29.00", currency: "RUB" };
    const posts: { url: string; auth: string | null; key: string | null; body: Record<string, unknown> }[] = [];
    let paymentId = "";
    let refundId = "";
    let actualAmount = amount;
    let testPayment = true;
    let providerStatus = "succeeded";
    subtest.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      if (method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push({ url, auth: headers.get("Authorization"), key: headers.get("Idempotence-Key"), body });
        const metadata = body.metadata as Record<string, string>;
        if (url === root + "/payments") {
          paymentId = metadata.recipe_payment_id;
        } else {
          refundId = metadata.recipe_refund_id;
        }
        throw new TypeError("Response lost after provider accepted the request");
      }
      if (url === root + "/payments/" + paymentExternalId) {
        return Response.json({ id: paymentExternalId, status: providerStatus, paid: providerStatus === "succeeded",
          test: testPayment, amount: actualAmount, metadata: { recipe_payment_id: paymentId, recipe_order_id: order } });
      }
      assert.equal(url, root + "/refunds/" + refundExternalId);
      return Response.json({ id: refundExternalId, payment_id: paymentExternalId, status: "succeeded", amount: actualAmount,
        metadata: { recipe_payment_id: paymentId, recipe_refund_id: refundId } });
    });
    await assert.rejects(startRecipePayment(owner, order), failure("RECIPE_PAYMENT_PROVIDER_ERROR"));
    assert.equal((await startRecipePayment(owner, order)).status, "unknown");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, root + "/payments");
    assert.equal(posts[0].auth, "Basic " + Buffer.from("123456:test_fixture").toString("base64"));
    assert.equal(posts[0].key, paymentId);
    assert.deepEqual(posts[0].body.amount, amount);
    assert.deepEqual(posts[0].body.payment_method_data, { type: "bank_card" });
    assert.deepEqual(posts[0].body.metadata, { recipe_order_id: order, recipe_payment_id: paymentId });
    await db().query("UPDATE recipe_orders SET expires_at=now() - interval '1 minute' WHERE id=$1", [order]);
    actualAmount = { ...amount, value: "28.99" };
    await assert.rejects(applyRecipePaymentEvent(paymentExternalId), failure("RECIPE_PAYMENT_MISMATCH"));
    actualAmount = amount;
    testPayment = false;
    await assert.rejects(applyRecipePaymentEvent(paymentExternalId), failure("INVALID_RECIPE_PAYMENT"));
    testPayment = true;
    assert.equal(await orderStatus(order), "awaiting_payment");
    const [paid, duplicate] = await Promise.all([
      applyRecipePaymentEvent(paymentExternalId), applyRecipePaymentEvent(paymentExternalId),
    ]);
    assert.equal(paid.status, "succeeded");
    assert.deepEqual(paid, duplicate);
    assert.equal(await orderStatus(order), "queued");
    providerStatus = "canceled";
    assert.equal((await applyRecipePaymentEvent(paymentExternalId)).status, "succeeded");

    await db().query("UPDATE recipe_orders SET status='failed' WHERE id=$1", [order]);
    await assert.rejects(requestRecipeRefund(owner, order), failure("RECIPE_PAYMENT_PROVIDER_ERROR"));
    assert.equal((await requestRecipeRefund(owner, order)).refundStatus, "unknown");
    assert.equal(posts.length, 2);
    assert.equal(posts[1].url, root + "/refunds");
    assert.equal(posts[1].key, refundId);
    assert.deepEqual(posts[1].body, {
      amount, payment_id: paymentExternalId, metadata: { recipe_payment_id: paymentId, recipe_refund_id: refundId },
    });
    actualAmount = { ...amount, currency: "USD" };
    await assert.rejects(applyRecipeRefundEvent(refundExternalId), failure("INVALID_RECIPE_REFUND"));
    actualAmount = amount;
    const returned = await applyRecipeRefundEvent(refundExternalId);
    assert.equal(returned.refundStatus, "succeeded");
    assert.deepEqual(await applyRecipeRefundEvent(refundExternalId), returned);
  });
});
