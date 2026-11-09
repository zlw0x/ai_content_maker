import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGO45SMhGjGFAUIBACC9BH+K8i7ZAAAAAElFTkSuQmCC", "base64");
const expiry = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
const layout = { title: "Кружка", benefit: "", price: "", color: "#74529f", alignment: "left" };

async function registerForRecipe(page: Page, recipe: string) {
  await page.goto(`/apps/recipes?recipe=${recipe}`);
  await page.getByRole("link", { name: "Войти или зарегистрироваться" }).click();
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Email").fill(`studio-${randomUUID()}@example.invalid`);
  await page.getByLabel("Пароль").fill("Recipe Studio Password 2026!");
  await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/apps/recipes\\?recipe=${recipe}$`));
  await expect(page.getByLabel("Что подготовить")).toHaveValue(recipe);
}

test("premium wizard refreshes changed quotes and recovers the same order after a dropped response", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assetId = randomUUID();
  const orderId = randomUUID();
  const fileId = randomUUID();
  const quotes: string[] = [];
  const orderKeys: string[] = [];
  let uploads = 0;
  let status = "awaiting_payment";
  let payment: { mode: "mock"; status: "pending" | "succeeded"; confirmationUrl: null; refundStatus: null } | null = null;
  let design = { ...layout, title: "Синяя кружка" };
  let revision = 1;
  const order = () => ({
    id: orderId, status, priceKopecks: 13567, layout: design, revision, errorCode: null, expiresAt: expiry(),
    recipeKey: "ad-kit", version: 1, access: "premium", mock: true,
    files: status === "completed" ? [{ id: fileId, filename: "card.png", url: `/api/v1/assets/${fileId}` }] : [],
  });

  await page.route("**/api/v1/recipe-availability", route => route.fulfill({ json: {
    enabled: true, trialEnabled: true, verified: true, trialState: "available", mock: true, paymentMode: "mock",
  } }));
  await page.route("**/api/v1/assets", async route => {
    uploads++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataBuffer()?.includes(png)).toBe(true);
    await route.fulfill({ json: { id: assetId } });
  });
  await page.route(`**/api/v1/assets/${fileId}*`, route => route.fulfill({ body: png, contentType: "image/png" }));
  await page.route("**/api/v1/recipe-quotes", async route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ recipeKey: "ad-kit", assetId, access: "premium" });
    expect(body.layout.benefit).toBe("Ручная работа");
    quotes.push(body.layout.title);
    await route.fulfill({ json: { id: randomUUID(), priceKopecks: 13567, currency: "RUB", expiresAt: expiry() } });
  });
  await page.route("**/api/v1/recipe-orders", async route => {
    orderKeys.push(route.request().headers()["idempotency-key"]);
    expect(route.request().postDataJSON().quoteId).toMatch(/^[a-f\d-]{36}$/);
    if (orderKeys.length === 1) await route.abort();
    else await route.fulfill({ json: { id: orderId, status } });
  });
  await page.route(`**/api/v1/recipe-orders/${orderId}`, async route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      expect(body.revision).toBe(1);
      design = body.layout;
      revision++;
    }
    await route.fulfill({ json: order() });
  });
  await page.route(`**/api/v1/recipe-orders/${orderId}/payment`, async route => {
    if (route.request().method() === "POST") payment = { mode: "mock", status: "pending", confirmationUrl: null, refundStatus: null };
    await route.fulfill({ json: payment });
  });
  await page.route(`**/api/v1/recipe-orders/${orderId}/mock-payment`, async route => {
    expect(route.request().postDataJSON()).toEqual({ outcome: "succeeded" });
    payment = { mode: "mock", status: "succeeded", confirmationUrl: null, refundStatus: null };
    status = "completed";
    await route.fulfill({ json: payment });
  });

  await registerForRecipe(page, "ad-kit");
  await page.goto("/apps/product-card");
  await page.getByLabel("Фото товара").setInputFiles({ name: "item.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Название товара").fill("Кружка");
  await page.getByLabel("Преимущество (необязательно)").fill("Ручная работа");
  await page.getByRole("button", { name: "Создать карточку" }).click();
  await expect(page.getByRole("link", { name: "Скачать PNG" })).toBeVisible();
  await page.getByRole("button", { name: "Продолжить в студии с этим фото" }).click();
  await expect(page).toHaveURL(/\/apps\/recipes\?recipe=studio-card&handoff=[a-f\d-]{36}$/);
  const handoffUrl = page.url();
  await expect(page.getByLabel("Название товара")).toHaveValue("Кружка");
  await expect(page.getByLabel("Преимущество")).toHaveValue("Ручная работа");
  await expect(page.getByRole("img", { name: "Предпросмотр исходного фото" })).toBeVisible();
  expect(uploads).toBe(0);
  await page.getByLabel("Что подготовить").selectOption("ad-kit");
  const calculate = page.getByRole("button", { name: "Рассчитать стоимость" });
  const confirm = page.getByRole("button", { name: "Продолжить к тестовой оплате" });
  await calculate.click();
  await expect(page.getByText(/135,67\s*₽/)).toBeVisible();
  await page.getByLabel("Название товара").fill("Синяя кружка");
  await expect(confirm).toHaveCount(0);
  await calculate.click();
  await confirm.click();
  await expect(page.getByLabel("Название товара")).toBeDisabled();
  await page.getByRole("button", { name: "Проверить заказ" }).click();
  await expect(page).toHaveURL(new RegExp(`order=${orderId}$`));
  expect(quotes).toEqual(["Кружка", "Синяя кружка"]);
  expect(uploads).toBe(1);
  expect(orderKeys).toHaveLength(2);
  expect(orderKeys[0]).toMatch(/^[a-f\d-]{36}$/);
  expect(orderKeys[0]).toBe(orderKeys[1]);

  await page.getByRole("button", { name: "Создать тестовый платёж" }).click();
  await page.getByRole("button", { name: "Подтвердить тестовую оплату" }).click();
  await expect(page.getByRole("link", { name: "Скачать файл 1" })).toHaveAttribute("href", `/api/v1/assets/${fileId}`);
  await page.reload();
  await page.getByRole("button", { name: "Изменить оформление" }).click();
  await page.getByLabel("Название товара").fill("Обновлённая карточка");
  await page.getByRole("button", { name: "Сохранить оформление" }).click();
  await expect(page.getByRole("button", { name: "Изменить оформление" })).toBeEnabled();
  expect(design.title).toBe("Обновлённая карточка");
  expect(revision).toBe(2);

  await page.goto(handoffUrl);
  await expect(page.getByText(/Исходное фото больше не доступно/)).toBeVisible();
  await expect(page.getByLabel("Исходное фото")).toBeEnabled();
});

test("trial wizard confirms email and opens a free order without entering checkout", async ({ page }) => {
  const assetId = randomUUID();
  const orderId = randomUUID();
  const quoteId = randomUUID();
  let verified = false;
  let paymentReads = 0;
  await page.route("**/api/v1/recipe-availability", route => route.fulfill({ json: {
    enabled: true, trialEnabled: true, verified, trialState: "available", mock: true, paymentMode: "mock",
  } }));
  await page.route("**/api/v1/auth/verify-email/start", route => route.fulfill({ json: { delivery: "mock", demoCode: "348721" } }));
  await page.route("**/api/v1/auth/verify-email/confirm", async route => {
    expect(route.request().postDataJSON()).toEqual({ code: "348721" });
    verified = true;
    await route.fulfill({ json: { verified } });
  });
  await page.route("**/api/v1/assets", route => route.fulfill({ json: { id: assetId } }));
  await page.route("**/api/v1/recipe-quotes", async route => {
    expect(verified).toBe(true);
    expect(route.request().postDataJSON()).toMatchObject({ recipeKey: "remove-background", access: "trial", assetId });
    await route.fulfill({ json: { id: quoteId, priceKopecks: 0, currency: "RUB", expiresAt: expiry() } });
  });
  await page.route("**/api/v1/recipe-orders", async route => {
    expect(route.request().postDataJSON()).toEqual({ quoteId });
    await route.fulfill({ json: { id: orderId, status: "queued" } });
  });
  await page.route(`**/api/v1/recipe-orders/${orderId}`, route => route.fulfill({ json: {
    id: orderId, status: "processing", priceKopecks: 0, layout, revision: 1, errorCode: null, expiresAt: expiry(),
    recipeKey: "remove-background", version: 1, access: "trial", mock: true, files: [],
  } }));
  await page.route(`**/api/v1/recipe-orders/${orderId}/payment`, async route => {
    paymentReads++;
    await route.fulfill({ json: null });
  });
  await registerForRecipe(page, "remove-background");
  await page.getByLabel("Исходное фото").setInputFiles({ name: "item.png", mimeType: "image/png", buffer: png });
  const calculate = page.getByRole("button", { name: "Рассчитать стоимость" });
  await expect(calculate).toBeDisabled();
  await page.getByRole("button", { name: "Получить код" }).click();
  await expect(page.getByText(/Тестовый код · 348721/)).toBeVisible();
  await page.getByLabel("Код подтверждения").fill("348721");
  await page.getByRole("button", { name: "Подтвердить почту" }).click();
  await calculate.click();
  await page.getByRole("button", { name: "Запустить пробную обработку" }).click();
  await expect(page).toHaveURL(new RegExp(`order=${orderId}$`));
  await expect(page.getByRole("heading", { name: "Пробная обработка" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Создаём материалы" })).toBeVisible();
  expect(paymentReads).toBe(0);
});
test("the live example gallery has 12 pairs and keeps the selected example for sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/examples");
  const links = page.getByRole("link", { name: /Создать так же/ });
  await expect(links).toHaveCount(12);
  await expect(page.getByRole("img", { name: /Свеча из соевого воска, результат/ })).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await links.first().click();
  await expect(page).toHaveURL(/example=candle-studio-card/);
  const signIn = page.getByRole("link", { name: "Войти или зарегистрироваться" });
  const href = await signIn.getAttribute("href");
  expect(new URL(href!, page.url()).searchParams.get("next")).toContain("example=candle-studio-card");
});
