import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db, one } from "../src/server/db";
import { HttpError } from "../src/server/errors";
import {
  applyMockRecipePayment,
  applyRecipePaymentEvent,
  applyRecipeRefundEvent,
  checkRecipeSandbox,
  getRecipePayment,
  getRecipePaymentMode,
  reconcileRecipePayment,
  reconcileRecipeRefund,
  requestRecipeRefund,
  startRecipePayment,
  verifyRecipeSandbox,
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
      VALUES($1,$2,'studio-card',1,'{}',2900,'premium') RETURNING id`, [owner, asset]);
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
      await db().query("DELETE FROM recipe_outputs WHERE user_id=$1", [owner]);
      await db().query("DELETE FROM recipe_orders WHERE user_id=$1", [owner]);
      await db().query("DELETE FROM recipe_quotes WHERE user_id=$1", [owner]);
      await db().query("DELETE FROM media_assets WHERE user_id=$1", [owner]);
      await db().query("DELETE FROM users WHERE id IN ($1,$2)", [owner, other]);
    } finally {
      await db().end();
    }
  });
  await db().query("INSERT INTO users(id,email) VALUES ($1,$3),($2,$4)",
    [owner, other, owner + "@example.invalid", other + "@example.invalid"]);
  await db().query(`INSERT INTO media_assets(id,user_id,kind,object_key,media_type,byte_size)
    VALUES($1::uuid,$2,'input',$1::uuid::text,'image/png',1)`, [asset, owner]);

  await context.test("checkout availability and preflight distinguish a test shop from a payout gateway", async subtest => {
    process.env.RECIPE_PAYMENT_MODE = "yookassa-test";
    const fixtureKey = "test_*fixture";
    const requests: string[] = [];
    const root = "https://api.yookassa.ru/v3";
    const shop = { account_id: "123456", test: true, status: "enabled", payment_methods: ["bank_card"] };
    let account: object = shop;
    let accountStatus = 200;
    let payments: object = { type: "list", items: [] };
    subtest.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.method, "GET");
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("Authorization"), "Basic " + Buffer.from("123456:" + fixtureKey).toString("base64"));
      const url = String(input);
      requests.push(url);
      if (url === root + "/me") return Response.json(account, { status: accountStatus });
      assert.equal(url, root + "/payments?limit=1");
      return Response.json(payments);
    });

    try {
      delete process.env.YOOKASSA_TEST_SECRET_KEY;
      assert.equal(getRecipePaymentMode(), "disabled");
      const unpaid = await newOrder();
      await assert.rejects(startRecipePayment(owner, unpaid), failure("RECIPE_TEST_SHOP_UNAVAILABLE"));
      assert.equal(await getRecipePayment(owner, unpaid), null);
      await assert.rejects(checkRecipeSandbox(), failure("RECIPE_TEST_SHOP_UNAVAILABLE"));
      process.env.YOOKASSA_TEST_SECRET_KEY = "live_fixture";
      assert.equal(getRecipePaymentMode(), "disabled");
      assert.equal(requests.length, 0);

      process.env.YOOKASSA_TEST_SECRET_KEY = fixtureKey;
      assert.equal(getRecipePaymentMode(), "yookassa-test");
      assert.deepEqual(await checkRecipeSandbox(), { ready: true, test: true, bankCard: true });
      assert.deepEqual(requests.splice(0), [root + "/me", root + "/payments?limit=1"]);
      payments = { type: "list", items: [{ test: false }] };
      await assert.rejects(checkRecipeSandbox(), failure("RECIPE_TEST_SHOP_NOT_VERIFIED"));
      assert.deepEqual(requests.splice(0), [root + "/me", root + "/payments?limit=1"]);

      account = { account_id: "123456", test: true, status: "disabled", payout_balance: { value: "0.00", currency: "RUB" } };
      await assert.rejects(checkRecipeSandbox(), failure("RECIPE_TEST_SHOP_PAYOUT_GATEWAY"));
      assert.deepEqual(requests.splice(0), [root + "/me"]);
      account = { ...shop, status: "disabled" };
      await assert.rejects(checkRecipeSandbox(), failure("RECIPE_TEST_SHOP_DISABLED"));
      assert.deepEqual(requests.splice(0), [root + "/me"]);
      account = { ...shop, payment_methods: ["yoo_money"] };
      await assert.rejects(checkRecipeSandbox(), failure("RECIPE_TEST_SHOP_NO_CARDS"));
      assert.deepEqual(requests.splice(0), [root + "/me"]);
      account = { ...shop, test: false };
      await assert.rejects(checkRecipeSandbox(), failure("RECIPE_TEST_SHOP_NOT_VERIFIED"));
      assert.deepEqual(requests.splice(0), [root + "/me"]);
      accountStatus = 401;
      await assert.rejects(checkRecipeSandbox(), failure("RECIPE_TEST_SHOP_AUTH"));
      assert.deepEqual(requests, [root + "/me"]);
    } finally {
      process.env.YOOKASSA_TEST_SECRET_KEY = "test_fixture";
    }
  });

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

  await context.test("YooKassa recovery and sandbox verification use provider reads without replay", async subtest => {
    process.env.RECIPE_PAYMENT_MODE = "yookassa-test";
    const order = await newOrder();
    const otherOrder = await newOrder();
    const otherPayment = randomUUID();
    await db().query(`INSERT INTO recipe_payments (id,order_id,amount_kopecks,mode,status)
      VALUES ($1,$2,2900,'yookassa-test','unknown')`, [otherPayment, otherOrder]);
    const paymentExternalId = "payment-fixture-1";
    const refundExternalId = "refund-fixture-1";
    const root = "https://api.yookassa.ru/v3";
    const amount = { value: "29.00", currency: "RUB" };
    const posts: { url: string; auth: string | null; key: string | null; body: Record<string, unknown> }[] = [];
    const reads: string[] = [];
    const sandboxPayments = new Map<string, object>();
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
      assert.equal(method, "GET");
      assert.equal(headers.get("Authorization"), "Basic " + Buffer.from("123456:test_fixture").toString("base64"));
      assert.equal(init?.body, undefined);
      reads.push(url);
      if (url === root + "/payments/" + paymentExternalId) {
        return Response.json({ id: paymentExternalId, status: providerStatus, paid: providerStatus === "succeeded",
          test: testPayment, amount: actualAmount, metadata: { recipe_payment_id: paymentId, recipe_order_id: order } });
      }
      const sandboxPayment = sandboxPayments.get(url);
      if (sandboxPayment) return Response.json(sandboxPayment);
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
    await assert.rejects(reconcileRecipePayment(otherOrder, paymentExternalId), failure("RECIPE_PAYMENT_MISMATCH"));
    assert.equal((await getRecipePayment(owner, order))?.status, "unknown");
    assert.equal((await getRecipePayment(owner, otherOrder))?.status, "unknown");
    assert.equal(await orderStatus(order), "awaiting_payment");
    assert.equal(await orderStatus(otherOrder), "awaiting_payment");
    const beforePayment = reads.length;
    const [paid, duplicate] = await Promise.all([
      reconcileRecipePayment(order, paymentExternalId), reconcileRecipePayment(order, paymentExternalId),
    ]);
    assert.deepEqual(reads.slice(beforePayment), Array(2).fill(root + "/payments/" + paymentExternalId));
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
    await db().query(`UPDATE recipe_payments SET status='succeeded', external_id='payment-fixture-other',
      refund_id=$2, refund_status='unknown' WHERE id=$1`, [otherPayment, randomUUID()]);
    await assert.rejects(reconcileRecipeRefund(otherOrder, refundExternalId), failure("RECIPE_REFUND_MISMATCH"));
    assert.equal((await getRecipePayment(owner, order))?.refundStatus, "unknown");
    assert.equal((await getRecipePayment(owner, otherOrder))?.refundStatus, "unknown");
    const beforeRefund = reads.length;
    const [returned, repeatRefund] = await Promise.all([
      reconcileRecipeRefund(order, refundExternalId), reconcileRecipeRefund(order, refundExternalId),
    ]);
    assert.deepEqual(reads.slice(beforeRefund), Array(2).fill(root + "/refunds/" + refundExternalId));
    assert.equal(returned.refundStatus, "succeeded");
    assert.deepEqual(repeatRefund, returned);
    assert.deepEqual(await applyRecipeRefundEvent(refundExternalId), returned);
    assert.equal(posts.length, 2);
    const events = await db().query<{ kind: string; status: string }>(
      "SELECT kind,status FROM recipe_payment_events WHERE payment_id=$1 ORDER BY kind,status", [paymentId]);
    assert.deepEqual(events.rows, [
      { kind: "payment", status: "succeeded" }, { kind: "payment", status: "unknown" },
      { kind: "refund", status: "succeeded" }, { kind: "refund", status: "unknown" },
    ]);

    providerStatus = "succeeded";
    const delivered = await newOrder();
    const canceled = await newOrder();
    for (const [orderId, id, status] of [
      [delivered, "delivered-fixture-1", "succeeded"],
      [canceled, "canceled-fixture-1", "canceled"],
    ] as const) {
      const localId = randomUUID();
      await db().query(`INSERT INTO recipe_payments (id,order_id,amount_kopecks,mode,status,external_id)
        VALUES ($1,$2,2900,'yookassa-test',$3,$4)`, [localId, orderId, status, id]);
      await db().query(`INSERT INTO recipe_payment_events(payment_id,kind,status) VALUES($1,'payment',$2)`, [localId, status]);
      sandboxPayments.set(root + "/payments/" + id, { id, status, paid: status === "succeeded", test: true,
        amount, metadata: { recipe_payment_id: localId, recipe_order_id: orderId } });
    }
    await db().query("UPDATE recipe_orders SET status='completed',completed_at=now() WHERE id=$1", [delivered]);
    for (let slot = 0; slot < 3; slot++) {
      const output = randomUUID();
      await db().query(`INSERT INTO media_assets(id,user_id,kind,object_key,media_type,byte_size,expires_at)
        VALUES($1,$2,'output',$3,'image/png',1,now()+interval '1 day')`, [output, owner, "output/" + output]);
      await db().query(`INSERT INTO recipe_outputs(order_id,user_id,asset_id,revision,slot,filename)
        VALUES($1,$2,$3,1,$4,$5)`, [delivered, owner, output, slot, `sample-${slot}.png`]);
    }
    const beforeAudit = reads.length;
    assert.deepEqual(await verifyRecipeSandbox(delivered, canceled, order), [
      { scenario: "delivered", orderStatus: "completed", paymentStatus: "succeeded", refundStatus: null, amountKopecks: 2900, currency: "RUB", activePngRecords: 3 },
      { scenario: "canceled", orderStatus: "awaiting_payment", paymentStatus: "canceled", refundStatus: null, amountKopecks: 2900, currency: "RUB", activePngRecords: 0 },
      { scenario: "refunded", orderStatus: "failed", paymentStatus: "succeeded", refundStatus: "succeeded", amountKopecks: 2900, currency: "RUB", activePngRecords: 0 },
    ]);
    assert.deepEqual(reads.slice(beforeAudit), [
      root + "/payments/delivered-fixture-1", root + "/payments/canceled-fixture-1",
      root + "/payments/" + paymentExternalId, root + "/refunds/" + refundExternalId,
    ]);
    await assert.rejects(verifyRecipeSandbox(delivered, delivered, order), failure("RECIPE_SANDBOX_CASES"));
    await assert.rejects(verifyRecipeSandbox(canceled, delivered, order), failure("RECIPE_SANDBOX_LOCAL_MISMATCH"));
    actualAmount = { ...amount, value: "29.01" };
    await assert.rejects(verifyRecipeSandbox(delivered, canceled, order), failure("RECIPE_SANDBOX_PROVIDER_MISMATCH"));
    assert.equal(posts.length, 2);
  });
});
