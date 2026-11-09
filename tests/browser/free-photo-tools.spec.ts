import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

async function downloadPhoto(page: Page, label: string, filename: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: `Скачать ${label}` }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  return readFile(await download.path());
}

test("free photo tools keep images local and resize, crop and convert them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/apps/photo-tools");
  await expect(page.getByLabel("Исходное фото")).toHaveCount(0);
  await page.getByRole("link", { name: "Войти или зарегистрироваться" }).click();
  await page.getByRole("button", { name: "Нет аккаунта? Зарегистрироваться" }).click();
  await page.getByLabel("Email").fill(`photo-${randomUUID()}@example.invalid`);
  await page.getByLabel("Пароль").fill("Photo Test Password 2026!");
  await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/photo-tools$/);

  const apiRequests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/")) apiRequests.push(request.url());
  });

  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 2;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#f00";
    context.fillRect(0, 0, 4, 2);
    context.fillStyle = "#0f0";
    context.fillRect(1, 0, 2, 2);
    return canvas.toDataURL("image/png");
  });
  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  const input = page.getByLabel("Исходное фото");
  const submit = page.getByRole("button", { name: "Подготовить фото" });
  const status = page.getByRole("status").filter({ hasText: "×" });
  const preview = page.getByRole("img", { name: "Обработанное фото" });
  await expect(input).toBeEnabled({ timeout: 10_000 });

  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(6000, 16);
  oversized.writeUInt32BE(5000, 20);
  await input.setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: oversized });
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "24 мегапикселей" })).toBeVisible();
  await expect(preview).toHaveCount(0);

  await input.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Ширина, пиксели").fill("2");
  await page.getByLabel("Высота, пиксели").fill("2");
  await submit.click();
  await expect(status).toHaveText("2 × 1 · PNG");

  await page.getByLabel("Действие").selectOption("crop");
  await expect(page.getByRole("link", { name: "Скачать PNG" })).toHaveCount(0);
  await submit.click();
  await expect(status).toHaveText("2 × 2 · PNG");
  const pixels = await preview.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 2, 2).data];
  });
  expect(pixels).toEqual(Array.from({ length: 4 }, () => [0, 255, 0, 255]).flat());

  await page.getByLabel("Действие").selectOption("original");
  await page.getByLabel("Формат файла").selectOption("image/jpeg");
  await submit.click();
  await expect(status).toHaveText("4 × 2 · JPEG");
  const jpeg = await downloadPhoto(page, "JPEG", "photo.jpg");
  expect([...jpeg.subarray(0, 3)]).toEqual([255, 216, 255]);

  await input.setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByLabel("Формат файла").selectOption("image/webp");
  await submit.click();
  await expect(status).toHaveText("4 × 2 · WebP");
  const webp = await downloadPhoto(page, "WebP", "photo.webp");
  expect(webp.toString("ascii", 0, 4)).toBe("RIFF");
  expect(webp.toString("ascii", 8, 12)).toBe("WEBP");

  await input.setInputFiles({ name: "photo.webp", mimeType: "image/webp", buffer: webp });
  await page.getByLabel("Формат файла").selectOption("image/png");
  await submit.click();
  await expect(status).toHaveText("4 × 2 · PNG");
  const exported = await downloadPhoto(page, "PNG", "photo.png");
  expect(exported.subarray(0, 8)).toEqual(png.subarray(0, 8));
  expect(apiRequests).toEqual([]);
});
