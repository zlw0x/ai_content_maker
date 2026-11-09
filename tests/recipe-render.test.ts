import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { RecipeLayout } from "../src/lib/recipes";
import { normalizeRecipeInput, renderRecipe } from "../src/server/recipe-render";

const layout: RecipeLayout = {
  title: "Свеча & <стекло>", benefit: "Мягкий свет & аромат кедра", price: "1 290 ₽",
  color: "#704eb2", alignment: "center",
};

test("recipe normalization applies orientation and bounds the PNG without metadata", async () => {
  const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#92a9ca" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const normalized = await sharp(await normalizeRecipeInput(source)).metadata();
  assert.equal(normalized.format, "png");
  assert.equal(normalized.width, 1024);
  assert.equal(normalized.height, 2048);
  assert.equal(normalized.exif, undefined);
  await assert.rejects(async () => normalizeRecipeInput(Buffer.from("<svg/>")), /JPG, PNG/);
  const oversized = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: "black" } }).png().toBuffer();
  await assert.rejects(normalizeRecipeInput(oversized), /pixel limit/i);
});

test("photo operations preserve transparency and composition recipes render each intended format", async () => {
  const source = await sharp({ create: { width: 128, height: 96, channels: 4, background: { r: 80, g: 125, b: 35, alpha: 0.5 } } })
    .png().toBuffer();
  const [transparent] = await renderRecipe("remove-background", source, layout);
  const [enhanced] = await renderRecipe("enhance-photo", source, layout);
  const expectedPixels = await sharp(source).raw().toBuffer();
  assert.deepEqual(await sharp(transparent.body).raw().toBuffer(), expectedPixels);
  assert.deepEqual(await sharp(enhanced.body).raw().toBuffer(), expectedPixels);

  const studio = await renderRecipe("studio-card", source, layout);
  assert.deepEqual(studio.map(file => file.filename), ["studio-porcelain.png", "studio-accent.png", "studio-midnight.png"]);
  for (const file of studio) {
    const meta = await sharp(file.body).metadata();
    assert.deepEqual([meta.width, meta.height], [1200, 1600]);
  }
  assert.notDeepEqual(studio[0].body, studio[1].body);

  const kit = await renderRecipe("ad-kit", source, layout);
  const banner = await renderRecipe("ad-banner", source, layout);
  const actual = await Promise.all(kit.map(async file => {
    const meta = await sharp(file.body).metadata();
    return [file.filename, meta.width, meta.height];
  }));
  assert.deepEqual(actual, [
    ["product-card.png", 1200, 1600], ["square.png", 1080, 1080],
    ["story.png", 1080, 1920], ["cover.png", 1200, 628],
  ]);
  assert.deepEqual(kit.slice(1), banner);
  await assert.rejects(renderRecipe("studio-card", source, { ...layout, color: '\"/><image href="file:///x"/>' }), /Invalid recipe layout/);
});
