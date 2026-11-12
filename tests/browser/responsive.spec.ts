import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function capture(page: Page, testInfo: TestInfo, screen: string, width: number) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(async image => {
      image.loading = "eager";
      await image.decode();
    }));
  });
  await page.screenshot({ path: testInfo.outputPath(`responsive-${screen}-${width}.png`), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function expectKeyboardFocus(control: Locator) {
  await expect(control).toBeFocused();
  expect(await control.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
  })).toBe(true);
}

test("key screens fit four viewport widths and keep keyboard controls reachable", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const registration = await page.request.post("/api/v1/auth/register", {
    headers: { Origin: "http://localhost:3000" },
    data: { email: `responsive-${randomUUID()}@example.invalid`, password: "Responsive Browser Password 2026!" },
  });
  expect(registration.status()).toBe(201);
  await page.route("**/api/v1/recipe-availability", route => route.fulfill({ json: {
    enabled: true, trialEnabled: true, verified: false, trialState: "available", mock: true, paymentMode: "mock",
  } }));

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await capture(page, testInfo, "home", width);
    await page.getByRole("link", { name: "Собрать карточку" }).focus();
    await page.keyboard.press("Tab");
    const examples = page.getByRole("link", { name: "Смотреть примеры" });
    await expectKeyboardFocus(examples);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#showcase$/);

    await page.goto("/examples");
    await expect(page.getByRole("link", { name: /Создать так же/ })).toHaveCount(12);
    await capture(page, testInfo, "examples", width);
    const exampleLinks = page.getByRole("link", { name: /Создать так же/ });
    await exampleLinks.first().focus();
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(exampleLinks.nth(1));

    await page.goto("/apps/photo-tools");
    const operation = page.getByLabel("Действие");
    await expect(operation).toBeEnabled();
    await capture(page, testInfo, "photo-tools", width);
    await operation.focus();
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(page.getByLabel("Размер заготовки"));

    await page.goto("/apps/recipes?recipe=studio-card");
    const recipe = page.getByLabel("Что подготовить");
    await expect(recipe).toBeEnabled();
    await capture(page, testInfo, "recipe-wizard", width);
    await recipe.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Исходное фото")).toBeFocused();
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(page.getByLabel("Название товара"));
  }

  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await capture(page, testInfo, "recipe-large-text", 320);
});
