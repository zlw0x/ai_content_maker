import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "./config";
import { one, transaction } from "./db";
import { assert, HttpError } from "./errors";

type PaymentMode = "mock" | "yookassa-test";
type ObservedStatus = "pending" | "succeeded" | "canceled";
type PaymentStatus = ObservedStatus | "unknown";
type PaymentRow = {
  id: string;
  order_id: string;
  amount_kopecks: number;
  mode: PaymentMode;
  status: PaymentStatus;
  external_id: string | null;
  confirmation_url: string | null;
  refund_id: string | null;
  refund_external_id: string | null;
  refund_status: PaymentStatus | null;
};
type OrderRow = { price_kopecks: number; status: string; unexpired: boolean; provider_mode: "mock" | "live" };

const uuid = z.string().uuid();
const providerId = z.string().regex(/^[a-zA-Z0-9-]{10,80}$/);
const observedStatus = z.enum(["pending", "succeeded", "canceled"]);
const rubAmount = z.object({
  value: z.string().regex(/^\d{1,8}\.\d{2}$/),
  currency: z.literal("RUB"),
});
const paymentObject = z.object({
  id: providerId,
  test: z.literal(true),
  status: z.union([observedStatus, z.literal("waiting_for_capture")]),
  paid: z.boolean(),
  amount: rubAmount,
  metadata: z.object({ recipe_payment_id: uuid, recipe_order_id: uuid }),
  confirmation: z.object({ confirmation_url: z.string().optional() }).optional(),
});
const refundObject = z.object({
  id: providerId,
  payment_id: providerId,
  status: observedStatus,
  amount: rubAmount,
  metadata: z.object({ recipe_payment_id: uuid, recipe_refund_id: uuid }),
});

export function getRecipePaymentMode(): PaymentMode | "disabled" {
  const mode = process.env.RECIPE_PAYMENT_MODE;
  if (mode !== "mock" && mode !== "yookassa-test") return "disabled";
  const settings = config();
  if (settings.PAYMENT_MODE !== "disabled" || settings.ALLOW_LIVE_PAYMENTS !== "false" ||
      settings.WAVESPEED_MODE !== "mock") return "disabled";
  return mode;
}

function testCredentials() {
  const shop = process.env.YOOKASSA_TEST_SHOP_ID;
  const key = process.env.YOOKASSA_TEST_SECRET_KEY;
  assert(shop && /^\d+$/.test(shop) && key && /^test_[A-Za-z0-9_-]+$/.test(key),
    503, "RECIPE_TEST_SHOP_UNAVAILABLE", "Настройте ключ тестового магазина ЮKassa");
  return { shop, key };
}

function requireMode(expected?: PaymentMode): PaymentMode {
  const mode = getRecipePaymentMode();
  assert(mode !== "disabled" && (!expected || mode === expected),
    503, "RECIPE_PAYMENTS_DISABLED", "Этот режим оплаты недоступен");
  if (mode === "yookassa-test") testCredentials();
  return mode;
}

function validateOrderId(orderId: string) {
  assert(uuid.safeParse(orderId).success, 422, "INVALID_RECIPE_ORDER", "Неверный идентификатор заказа");
}

function amountToKopecks(amount: z.infer<typeof rubAmount>) {
  const [rubles, kopecks] = amount.value.split(".");
  return Number(rubles) * 100 + Number(kopecks);
}

function paymentAmount(amountKopecks: number) {
  return { value: (amountKopecks / 100).toFixed(2), currency: "RUB" };
}

function checkoutUrl(value: string | undefined) {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(502, "INVALID_RECIPE_CHECKOUT_URL", "ЮKassa вернула неверную ссылку для оплаты");
  }
  assert(url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["yoomoney.ru", "yookassa.ru", "checkout.yookassa.ru"].includes(url.hostname),
    502, "INVALID_RECIPE_CHECKOUT_URL", "ЮKassa вернула неверную ссылку для оплаты");
  return url.href;
}

async function testRequest(endpoint: string, operation?: { key: string; body: object }): Promise<unknown> {
  requireMode("yookassa-test");
  const { shop, key } = testCredentials();
  try {
    const response = await fetch("https://api.yookassa.ru/v3" + endpoint, {
      method: operation ? "POST" : "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(shop + ":" + key).toString("base64"),
        ...(operation ? { "Content-Type": "application/json", "Idempotence-Key": operation.key } : {}),
      },
      body: operation ? JSON.stringify(operation.body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Request failed");
    return await response.json();
  } catch {
    throw new HttpError(502, "RECIPE_PAYMENT_PROVIDER_ERROR", "Статус операции ЮKassa требует сверки");
  }
}

function publicPayment(row: PaymentRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    mode: row.mode,
    amountKopecks: row.amount_kopecks,
    currency: "RUB" as const,
    confirmationUrl: row.confirmation_url,
    refundStatus: row.refund_status,
  };
}

// Operations changing both records always lock the order before the payment.
async function lockOrder(client: PoolClient, orderId: string, userId?: string) {
  const { rows: [order] } = await client.query<OrderRow>(`
    SELECT price_kopecks, status, provider_mode, expires_at > now() AS unexpired
    FROM recipe_orders WHERE id=$1 AND ($2::uuid IS NULL OR user_id=$2) FOR UPDATE`, [orderId, userId ?? null]);
  assert(order, 404, "RECIPE_ORDER_NOT_FOUND", "Заказ не найден");
  return order;
}

async function lockPayment(client: PoolClient, orderId: string) {
  const { rows: [payment] } = await client.query<PaymentRow>(
    "SELECT * FROM recipe_payments WHERE order_id=$1 FOR UPDATE", [orderId]);
  return payment;
}

async function recordEvent(client: PoolClient, paymentId: string, kind: "payment" | "refund", status: PaymentStatus) {
  await client.query(`INSERT INTO recipe_payment_events(payment_id, kind, status)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [paymentId, kind, status]);
}

async function updatePayment(client: PoolClient, current: PaymentRow, status: ObservedStatus,
    externalId: string | null, url: string | null) {
  if (current.status === "succeeded" || current.status === "canceled") return current;
  const { rows: [updated] } = await client.query<PaymentRow>(`
    UPDATE recipe_payments SET status=$2, external_id=$3, confirmation_url=$4, updated_at=now()
    WHERE id=$1 RETURNING *`, [current.id, status, externalId, status === "pending" ? url ?? current.confirmation_url : null]);
  await recordEvent(client, current.id, "payment", status);
  if (status === "succeeded") {
    // The original expiry only gates new checkout creation. An accepted payment is honored.
    await client.query(`UPDATE recipe_orders SET status='queued', updated_at=now()
      WHERE id=$1 AND status='awaiting_payment' AND provider_mode='mock'`,
      [current.order_id]);
  }
  return updated;
}

async function recordProviderPayment(raw: unknown, expectedExternalId?: string, expectedLocalId?: string) {
  const parsed = paymentObject.safeParse(raw);
  assert(parsed.success, 502, "INVALID_RECIPE_PAYMENT", "ЮKassa вернула непроверенный тестовый платёж");
  const payment = parsed.data;
  const { recipe_order_id: orderId, recipe_payment_id: paymentId } = payment.metadata;
  assert((!expectedExternalId || expectedExternalId === payment.id) && (!expectedLocalId || expectedLocalId === paymentId) &&
      (payment.status !== "succeeded" || payment.paid),
    409, "RECIPE_PAYMENT_MISMATCH", "Платёж требует сверки");
  const status = payment.status === "waiting_for_capture" ? "pending" : payment.status;
  const url = status === "pending" ? checkoutUrl(payment.confirmation?.confirmation_url) : null;
  return transaction(async client => {
    const order = await lockOrder(client, orderId);
    const current = await lockPayment(client, orderId);
    assert(current && current.id === paymentId && current.mode === "yookassa-test" &&
        (!current.external_id || current.external_id === payment.id) &&
        current.amount_kopecks === order.price_kopecks && current.amount_kopecks === amountToKopecks(payment.amount),
      409, "RECIPE_PAYMENT_MISMATCH", "Платёж требует сверки");
    return updatePayment(client, current, status, payment.id, url);
  });
}

export async function getRecipePayment(userId: string, orderId: string) {
  validateOrderId(orderId);
  const payment = await one<PaymentRow>(`SELECT p.* FROM recipe_payments p JOIN recipe_orders o ON o.id=p.order_id
    WHERE o.user_id=$1 AND o.id=$2`, [userId, orderId]);
  return payment ? publicPayment(payment) : null;
}

export async function startRecipePayment(userId: string, orderId: string, returnPath?: string) {
  validateOrderId(orderId);
  const mode = requireMode();
  const returnUrl = new URL(returnPath ?? "/apps/recipes?order=" + orderId, config().APP_ORIGIN);
  assert(returnUrl.origin === new URL(config().APP_ORIGIN).origin,
    422, "INVALID_RECIPE_RETURN", "Неверный адрес возврата после оплаты");
  const { payment, created } = await transaction(async client => {
    const order = await lockOrder(client, orderId, userId);
    const existing = await lockPayment(client, orderId);
    if (existing) {
      assert(existing.mode === mode, 409, "RECIPE_PAYMENT_MODE_CHANGED", "Платёж создан в другом режиме");
      return { payment: existing, created: false };
    }
    assert(order.provider_mode === "mock" && order.unexpired && order.status === "awaiting_payment" && order.price_kopecks > 0,
      409, "RECIPE_NOT_PAYABLE", "Срок оплаты заказа истёк или заказ уже обработан");
    // Persist the only create attempt before contacting the provider. An unknown result is reconciled, never re-posted.
    const status = mode === "mock" ? "pending" : "unknown";
    const { rows: [payment] } = await client.query<PaymentRow>(`INSERT INTO recipe_payments
      (id,order_id,amount_kopecks,mode,status) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [randomUUID(), orderId, order.price_kopecks, mode, status]);
    await recordEvent(client, payment.id, "payment", status);
    return { payment, created: true };
  });
  if (!created || mode === "mock") return publicPayment(payment);
  const result = await testRequest("/payments", {
    key: payment.id,
    body: {
      amount: paymentAmount(payment.amount_kopecks),
      capture: true,
      payment_method_data: { type: "bank_card" },
      confirmation: { type: "redirect", return_url: returnUrl.href },
      description: "Заказ «Сделано AI»",
      metadata: { recipe_payment_id: payment.id, recipe_order_id: orderId },
    },
  });
  return publicPayment(await recordProviderPayment(result, undefined, payment.id));
}

export async function applyRecipePaymentEvent(externalId: string) {
  assert(providerId.safeParse(externalId).success, 422, "INVALID_RECIPE_PAYMENT_ID", "Неверный ID платежа");
  return publicPayment(await recordProviderPayment(await testRequest("/payments/" + externalId), externalId));
}

export async function refreshRecipePayment(userId: string, orderId: string) {
  validateOrderId(orderId);
  const row = await one<PaymentRow>(`SELECT p.* FROM recipe_payments p JOIN recipe_orders o ON o.id=p.order_id
    WHERE o.user_id=$1 AND o.id=$2`, [userId, orderId]);
  assert(row, 404, "RECIPE_PAYMENT_NOT_FOUND", "Платёж не найден");
  if (row.mode !== "yookassa-test") return publicPayment(row);
  if (row.refund_external_id && row.refund_status === "pending") return applyRecipeRefundEvent(row.refund_external_id);
  if (row.external_id && row.status === "pending") return applyRecipePaymentEvent(row.external_id);
  return publicPayment(row);
}

export async function applyMockRecipePayment(userId: string, orderId: string, status: "succeeded" | "canceled") {
  validateOrderId(orderId);
  requireMode("mock");
  assert(status === "succeeded" || status === "canceled", 422, "INVALID_RECIPE_PAYMENT_STATUS", "Неверный статус тестового платежа");
  return transaction(async client => {
    await lockOrder(client, orderId, userId);
    const row = await lockPayment(client, orderId);
    assert(row && row.mode === "mock", 404, "RECIPE_PAYMENT_NOT_FOUND", "Тестовый платёж не найден");
    return publicPayment(await updatePayment(client, row, status, null, null));
  });
}

async function recordProviderRefund(raw: unknown, expectedExternalId?: string, expectedLocalId?: string) {
  const parsed = refundObject.safeParse(raw);
  assert(parsed.success, 502, "INVALID_RECIPE_REFUND", "ЮKassa вернула непроверенный возврат");
  const refund = parsed.data;
  const { recipe_payment_id: paymentId, recipe_refund_id: refundId } = refund.metadata;
  assert((!expectedExternalId || expectedExternalId === refund.id) && (!expectedLocalId || expectedLocalId === refundId),
    409, "RECIPE_REFUND_MISMATCH", "Возврат требует сверки");
  return transaction(async client => {
    const { rows: [match] } = await client.query<{ order_id: string }>(
      "SELECT order_id FROM recipe_payments WHERE id=$1", [paymentId]);
    assert(match, 404, "RECIPE_PAYMENT_NOT_FOUND", "Платёж не найден");
    await lockOrder(client, match.order_id);
    const row = await lockPayment(client, match.order_id);
    assert(row && row.id === paymentId && row.mode === "yookassa-test" && row.status === "succeeded" &&
        row.refund_id === refundId && row.external_id === refund.payment_id &&
        (!row.refund_external_id || row.refund_external_id === refund.id) &&
        row.amount_kopecks === amountToKopecks(refund.amount),
      409, "RECIPE_REFUND_MISMATCH", "Возврат требует сверки");
    if (row.refund_status === "succeeded" || row.refund_status === "canceled") return row;
    const { rows: [updated] } = await client.query<PaymentRow>(`UPDATE recipe_payments SET
      refund_external_id=$2, refund_status=$3, updated_at=now() WHERE id=$1 RETURNING *`,
      [row.id, refund.id, refund.status]);
    await recordEvent(client, row.id, "refund", refund.status);
    return updated;
  });
}

export async function applyRecipeRefundEvent(externalId: string) {
  assert(providerId.safeParse(externalId).success, 422, "INVALID_RECIPE_REFUND_ID", "Неверный ID возврата");
  return publicPayment(await recordProviderRefund(await testRequest("/refunds/" + externalId), externalId));
}

export async function requestRecipeRefund(userId: string, orderId: string) {
  validateOrderId(orderId);
  const mode = requireMode();
  const { payment, created } = await transaction(async client => {
    const order = await lockOrder(client, orderId, userId);
    const current = await lockPayment(client, orderId);
    assert(current && current.mode === mode && current.status === "succeeded",
      409, "RECIPE_REFUND_UNAVAILABLE", "Возврат доступен только после подтверждённой оплаты");
    if (current.refund_id) return { payment: current, created: false };
    assert(["failed", "canceled"].includes(order.status),
      409, "RECIPE_REFUND_UNAVAILABLE", "Возврат доступен после подтверждённого сбоя или отмены заказа");
    assert(mode === "mock" || current.external_id, 409, "RECIPE_PAYMENT_MISMATCH", "Платёж требует сверки");
    const status = mode === "mock" ? "succeeded" : "unknown";
    const { rows: [payment] } = await client.query<PaymentRow>(`UPDATE recipe_payments SET
      refund_id=$2, refund_status=$3, updated_at=now() WHERE id=$1 RETURNING *`, [current.id, randomUUID(), status]);
    await recordEvent(client, payment.id, "refund", status);
    return { payment, created: true };
  });
  if (!created || mode === "mock") return publicPayment(payment);
  const refundId = payment.refund_id!;
  const result = await testRequest("/refunds", {
    key: refundId,
    body: {
      amount: paymentAmount(payment.amount_kopecks),
      payment_id: payment.external_id,
      metadata: { recipe_payment_id: payment.id, recipe_refund_id: refundId },
    },
  });
  return publicPayment(await recordProviderRefund(result, undefined, refundId));
}
