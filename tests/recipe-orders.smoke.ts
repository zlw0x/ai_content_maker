import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { db } from "../src/server/db";

const origin = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000").origin;
const base = origin + "/api/v1";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let pool: ReturnType<typeof db> | undefined;
const layout = {
  title: "Термокружка", benefit: "Сохраняет тепло", price: "490 ₽", color: "#74529f", alignment: "left",
};

type Reply<T> = { response: Response; body: T };
type RecipeFile = { filename: string; url: string };
type Order = { id: string; status: string; mock: boolean; revision: number; files: RecipeFile[] };
type Quote = { id: string; priceKopecks: number };
type Payment = { id: string; status: string; amountKopecks: number; mode: string };
type Availability = { enabled: boolean; mock: boolean; paymentMode: string; trialEnabled: boolean; verified: boolean; trialState: string };

async function api<T>(path: string, cookie = "", method = "GET", payload?: unknown, key?: string): Promise<Reply<T>> {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin, "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  return { response, body: await response.json() as T };
}

function expectStatus<T>(reply: Reply<T>, status: number): T {
  assert.equal(reply.response.status, status, JSON.stringify(reply.body));
  return reply.body;
}

function expectOk<T>(reply: Reply<T>): T {
  assert.ok(reply.response.ok, JSON.stringify(reply.body));
  return reply.body;
}

async function register(role: string) {
  const reply = await api("/auth/register", "", "POST", {
    email: `recipe-${role}-${randomUUID()}@example.invalid`, password: "Recipe Smoke Password 2026!",
  });
  expectStatus(reply, 201);
  const cookie = reply.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(cookie, /^acm_session=/);
  return cookie;
}

async function upload(cookie: string) {
  const png = await readFile("public/examples/product-card/thermos.png");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "thermos.png");
  const response = await fetch(base + "/assets", {
    method: "POST", headers: { Origin: origin, Cookie: cookie }, body: form,
    redirect: "manual", signal: AbortSignal.timeout(10_000),
  });
  return expectStatus({ response, body: await response.json() as { id: string } }, 201).id;
}

async function waitForOrder(cookie: string, orderId: string) {
  let order: Order | undefined;
  for (let attempt = 0; attempt < 90; attempt++) {
    order = expectStatus(await api<Order>("/recipe-orders/" + orderId, cookie), 200);
    if (order.status === "completed") return order;
    assert.ok(!["failed", "unknown"].includes(order.status), JSON.stringify(order));
    await wait(500);
  }
  assert.fail("Recipe worker did not complete: " + JSON.stringify(order));
}

function download(cookie: string, file: RecipeFile) {
  assert.match(file.filename, /\.png$/);
  assert.match(file.url, /^\/api\/v1\/assets\/[a-f0-9-]+$/i);
  return fetch(origin + file.url, { headers: { Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
}

async function expectPng(cookie: string, file: RecipeFile) {
  const response = await download(cookie, file);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes.subarray(0, pngSignature.length), pngSignature);
}

async function providerSnapshot(orderId: string) {
  pool ??= db();
  const { rows: [snapshot] } = await pool.query(`SELECT attempt_id, provider_prediction_id, prepared_asset_id, provider_cost_usd
    FROM recipe_orders WHERE id=$1`, [orderId]);
  assert.ok(snapshot?.prepared_asset_id, "Expected a prepared image attached to the completed recipe");
  return snapshot;
}

async function main() {
  expectStatus(await api("/recipe-availability"), 401);
  const owner = await register("owner");
  const stranger = await register("stranger");
  const availability = expectStatus(await api<Availability>("/recipe-availability", owner), 200);
  assert.equal(availability.enabled, true, "Enable recipe orders in the isolated test environment");
  assert.equal(availability.mock, true, "Recipe smoke requires WAVESPEED_MODE=mock");
  assert.equal(availability.paymentMode, "mock", "Recipe smoke requires RECIPE_PAYMENT_MODE=mock");
  assert.equal(availability.trialEnabled, true, "Enable Trial in the isolated test environment");
  assert.equal(availability.verified, false);
  const walletBefore = expectStatus(await api("/wallet", owner), 200);
  const assetId = await upload(owner);

  const premiumInput = { recipeKey: "studio-card", assetId, access: "premium", layout };
  expectStatus(await api("/recipe-quotes", stranger, "POST", premiumInput), 404);
  const premiumQuote = expectStatus(await api<Quote>("/recipe-quotes", owner, "POST", premiumInput), 201);
  assert.equal(premiumQuote.priceKopecks, 2900);
  const quoteId = { quoteId: premiumQuote.id };
  const key = randomUUID();
  const [orderReply, repeatReply] = await Promise.all([
    api<Order>("/recipe-orders", owner, "POST", quoteId, key),
    api<Order>("/recipe-orders", owner, "POST", quoteId, key),
  ]);
  const premium = expectOk(orderReply);
  assert.equal(expectOk(repeatReply).id, premium.id);
  assert.equal(premium.status, "awaiting_payment");
  const path = "/recipe-orders/" + premium.id;
  expectStatus(await api(path, stranger), 404);
  expectStatus(await api(path + "/payment", stranger, "POST", {}), 404);

  const checkout = expectOk(await api<Payment>(path + "/payment", owner, "POST", {}));
  assert.equal(checkout.mode, "mock");
  assert.equal(checkout.status, "pending");
  assert.equal(checkout.amountKopecks, premiumQuote.priceKopecks);
  assert.equal(expectOk(await api<Payment>(path + "/payment", owner, "POST", {})).id, checkout.id);
  const paid = await Promise.all([
    api<Payment>(path + "/mock-payment", owner, "POST", { outcome: "succeeded" }),
    api<Payment>(path + "/mock-payment", owner, "POST", { outcome: "succeeded" }),
  ]);
  assert.deepEqual(expectOk(paid[0]), expectOk(paid[1]));
  assert.equal(paid[0].body.status, "succeeded");

  const result = await waitForOrder(owner, premium.id);
  assert.equal(result.mock, true);
  assert.equal(result.revision, 1);
  assert.equal(result.files.length, 3);
  assert.equal(new Set(result.files.map(file => file.url)).size, 3);
  await Promise.all(result.files.map(file => expectPng(owner, file)));
  assert.equal((await download(stranger, result.files[0])).status, 404);

  const edit = { revision: result.revision, layout: { ...layout, price: "390 ₽", alignment: "center" } };
  expectStatus(await api(path, stranger, "PATCH", edit), 404);
  const providerBefore = await providerSnapshot(premium.id);
  const updated = expectStatus(await api<Order>(path, owner, "PATCH", edit), 200);
  assert.equal(updated.revision, 2);
  assert.equal(updated.files.length, 3);
  assert.notDeepEqual(updated.files.map(file => file.url), result.files.map(file => file.url));
  assert.deepEqual(await providerSnapshot(premium.id), providerBefore, "Editing must reuse the provider result");
  await expectPng(owner, updated.files[0]);
  expectStatus(await api(path, owner, "PATCH", edit), 409);

  const trialInput = { recipeKey: "remove-background", assetId, access: "trial", layout };
  const trialQuote = expectStatus(await api<Quote>("/recipe-quotes", owner, "POST", trialInput), 201);
  assert.equal(trialQuote.priceKopecks, 0);
  const unverified = await api<{ error: { code: string } }>("/recipe-orders", owner, "POST", { quoteId: trialQuote.id }, randomUUID());
  assert.equal(expectStatus(unverified, 403).error.code, "TRIAL_EMAIL_REQUIRED");
  const verification = expectOk(await api<{ delivery: string; demoCode: string }>("/auth/verify-email/start", owner, "POST", {}));
  assert.equal(verification.delivery, "mock");
  assert.ok(verification.demoCode);
  expectOk(await api("/auth/verify-email/confirm", owner, "POST", { code: verification.demoCode }));
  assert.equal(expectStatus(await api<Availability>("/recipe-availability", owner), 200).verified, true);
  const alternative = expectStatus(await api<Quote>("/recipe-quotes", owner, "POST", { ...trialInput, recipeKey: "enhance-photo" }), 201);
  const trials = await Promise.all([
    api<{ id: string; error?: { code: string } }>("/recipe-orders", owner, "POST", { quoteId: trialQuote.id }, randomUUID()),
    api<{ id: string; error?: { code: string } }>("/recipe-orders", owner, "POST", { quoteId: alternative.id }, randomUUID()),
  ]);
  assert.equal(trials.filter(reply => reply.response.ok).length, 1, JSON.stringify(trials.map(reply => reply.body)));
  const accepted = trials.find(reply => reply.response.ok)!;
  const denied = trials.find(reply => !reply.response.ok)!;
  assert.equal(expectStatus(denied, 409).error?.code, "TRIAL_ALREADY_USED");
  const trial = await waitForOrder(owner, accepted.body.id);
  assert.equal(trial.files.length, 1);
  assert.equal(trial.mock, true);
  await expectPng(owner, trial.files[0]);
  assert.equal(expectStatus(await api<Availability>("/recipe-availability", owner), 200).trialState, "used");
  assert.deepEqual(expectStatus(await api("/wallet", owner), 200), walletBefore, "Recipe checkout and Trial do not mutate the legacy wallet");
  console.log("Recipe smoke OK — one mock checkout, private PNGs, paid edit without provider replay, and one Trial across concurrent requests");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool?.end());
