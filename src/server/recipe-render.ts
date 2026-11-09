import sharp, { type OverlayOptions } from "sharp";
import type { RecipeKey, RecipeLayout } from "../lib/recipes";
import { sniffImage } from "./media";

const maxInputPixels = 16_000_000;
const maxInputSide = 2048;
// A 2× provider upscale of a normalized square can reach 4096 × 4096.
const maxPreparedPixels = (2 * maxInputSide) ** 2;

function openPhoto(input: Buffer, limitInputPixels: number) {
  sniffImage(input);
  return sharp(input, { limitInputPixels }).autoOrient().toColourspace("srgb");
}

export function normalizeRecipeInput(input: Buffer): Promise<Buffer> {
  return openPhoto(input, maxInputPixels)
    .resize(maxInputSide, maxInputSide, { fit: "inside", withoutEnlargement: true })
    .png().toBuffer();
}

const palettes = {
  porcelain: { paper: "#f8f4eb", shade: "#ede5d8", stage: "#fffdfa", stageShade: "#e9dfcf", ink: "#25211f", muted: "#554e46" },
  accent: { paper: "#f4f3fa", shade: "#e4e6f5", stage: "#fdfcff", stageShade: "#dddff0", ink: "#242236", muted: "#514e67" },
  midnight: { paper: "#252d3f", shade: "#151a25", stage: "#424c61", stageShade: "#202638", ink: "#fffaf4", muted: "#d5d8e6" },
} as const;

type Art = { filename: string; width: number; height: number; palette: keyof typeof palettes };
type Box = { left: number; top: number; width: number; height: number };
type Align = RecipeLayout["alignment"];

const card: Art = { filename: "product-card.png", width: 1200, height: 1600, palette: "accent" };
const advertising: readonly Art[] = [
  { filename: "square.png", width: 1080, height: 1080, palette: "accent" },
  { filename: "story.png", width: 1080, height: 1920, palette: "accent" },
  { filename: "cover.png", width: 1200, height: 628, palette: "accent" },
];
const artwork: Record<Exclude<RecipeKey, "remove-background" | "enhance-photo">, readonly Art[]> = {
  "studio-card": [
    { ...card, filename: "studio-porcelain.png", palette: "porcelain" },
    { ...card, filename: "studio-accent.png" },
    { ...card, filename: "studio-midnight.png", palette: "midnight" },
  ],
  "ad-banner": advertising,
  "ad-kit": [card, ...advertising],
};

function artBoxes({ width, height }: Art): { photo: Box; copy: Box } {
  const margin = Math.round(Math.min(width, height) * 0.06);
  const gap = Math.round(margin * 0.75);
  if (width > height) {
    const left = Math.round(width * 0.53);
    return {
      photo: { left, top: margin, width: width - left - margin, height: height - 2 * margin },
      copy: { left: margin, top: margin + gap, width: left - margin - gap, height: height - 2 * (margin + gap) },
    };
  }
  const widthInside = width - 2 * margin;
  const photoHeight = Math.round(height * 0.58);
  const top = margin + photoHeight + gap;
  return {
    photo: { left: margin, top: margin, width: widthInside, height: photoHeight },
    copy: { left: margin + gap, top, width: widthInside - 2 * gap, height: height - top - margin },
  };
}

function escapeMarkup(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\ud800-\udfff\ufffe\uffff]/gu, "\ufffd").replace(/\s+/g, " ").trim()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function alignedLeft(box: Box, width: number, align: Align): number {
  if (align === "right") return box.left + box.width - width;
  return box.left + (align === "center" ? Math.round((box.width - width) / 2) : 0);
}

async function renderText(value: string, box: Box, align: Align, color: string, weight: "normal" | "bold", wrap: "none" | "word-char" = "word-char") {
  const text = escapeMarkup(value);
  if (!text) return null;
  return sharp({ text: {
    text: `<span foreground="${color}">${text}</span>`, font: weight === "bold" ? "DejaVu Sans Bold" : "DejaVu Sans",
    width: box.width, height: box.height, align, rgba: true, wrap,
  } }).png().toBuffer({ resolveWithObject: true });
}

function placeText(text: Awaited<ReturnType<typeof renderText>>, box: Box, align: Align): OverlayOptions[] {
  if (!text) return [];
  return [{ input: text.data, left: alignedLeft(box, text.info.width, align),
    top: box.top + Math.round((box.height - text.info.height) / 2) }];
}

function badgeInk(color: string): string {
  const rgb = color.slice(1).match(/../g)!.map(channel => Number.parseInt(channel, 16) / 255);
  const [red, green, blue] = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.179 ? "#000000" : "#ffffff";
}

async function composeArt(prepared: Buffer, art: Art, layout: RecipeLayout): Promise<Buffer> {
  const { width, height } = art;
  const palette = palettes[art.palette];
  const { photo, copy } = artBoxes(art);
  const { color, alignment } = layout;
  const radius = Math.round(Math.min(photo.width, photo.height) * 0.08);
  const gutter = Math.round(Math.min(photo.width, photo.height) * 0.11);
  const titleBox = { ...copy, top: copy.top + Math.round(copy.height * 0.12), height: Math.round(copy.height * 0.37) };
  const benefitBox = { ...copy, top: copy.top + Math.round(copy.height * 0.55), height: Math.round(copy.height * 0.17) };
  const badgeHeight = Math.round(copy.height * 0.20);
  const badgePadding = Math.round(badgeHeight * 0.38);
  const priceBox = { ...copy, top: copy.top + copy.height - badgeHeight, height: Math.round(badgeHeight * 0.55),
    width: copy.width - 2 * badgePadding };

  const [cutout, title, benefit, price] = await Promise.all([
    openPhoto(prepared, maxPreparedPixels).resize(photo.width - 2 * gutter, photo.height - 2 * gutter, { fit: "inside" })
      .png().toBuffer({ resolveWithObject: true }),
    renderText(layout.title, titleBox, alignment, palette.ink, "bold"),
    renderText(layout.benefit, benefitBox, alignment, palette.muted, "normal"),
    renderText(layout.price, priceBox, "center", badgeInk(color), "bold", "none"),
  ]);
  const badgeWidth = price ? price.info.width + 2 * badgePadding : 0;
  const badgeLeft = alignedLeft(copy, badgeWidth, alignment);
  const accentWidth = Math.round(Math.min(width, height) * 0.08);
  const stage = `x="${photo.left}" y="${photo.top}" width="${photo.width}" height="${photo.height}" rx="${radius}"`;
  const center = photo.left + photo.width / 2;
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="paper" x2="1" y2="1"><stop stop-color="${palette.paper}"/><stop offset="1" stop-color="${palette.shade}"/></linearGradient>
      <radialGradient id="stage"><stop stop-color="${palette.stage}"/><stop offset="1" stop-color="${palette.stageShade}"/></radialGradient>
      <clipPath id="frame"><rect ${stage}/></clipPath>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#paper)"/>
    <rect ${stage} fill="url(#stage)"/>
    <g clip-path="url(#frame)">
      <circle cx="${center}" cy="${photo.top + photo.height * 0.43}" r="${Math.min(photo.width, photo.height) * 0.42}" fill="${color}" opacity="0.16"/>
      <ellipse cx="${center}" cy="${photo.top + photo.height * 0.84}" rx="${photo.width * 0.33}" ry="${photo.height * 0.065}" fill="${color}" opacity="0.21"/>
    </g>
    <rect x="${alignedLeft(copy, accentWidth, alignment)}" y="${copy.top}" width="${accentWidth}" height="${Math.max(5, Math.round(copy.height * 0.018))}" rx="3" fill="${color}"/>
    ${price ? `<rect x="${badgeLeft}" y="${priceBox.top}" width="${badgeWidth}" height="${badgeHeight}" rx="${Math.round(badgeHeight / 2)}" fill="${color}"/>` : ""}
  </svg>`);

  return sharp(background).composite([
    { input: cutout.data, left: photo.left + Math.round((photo.width - cutout.info.width) / 2),
      top: photo.top + Math.round((photo.height - cutout.info.height) / 2) },
    ...placeText(title, titleBox, alignment),
    ...placeText(benefit, benefitBox, alignment),
    ...placeText(price, { left: badgeLeft, top: priceBox.top, width: badgeWidth, height: badgeHeight }, "center"),
  ]).png().toBuffer();
}

export async function renderRecipe(key: RecipeKey, prepared: Buffer, layout: RecipeLayout): Promise<{ filename: string; body: Buffer }[]> {
  if (key === "remove-background" || key === "enhance-photo") {
    return [{ filename: `${key}.png`, body: await openPhoto(prepared, maxPreparedPixels).png().toBuffer() }];
  }
  if (layout.color.length !== 7 || !/^#[\da-f]{6}$/i.test(layout.color) || !["left", "center", "right"].includes(layout.alignment)) {
    throw new Error("Invalid recipe layout");
  }
  const files = [];
  for (const art of artwork[key]) {
    files.push({ filename: art.filename, body: await composeArt(prepared, art, layout) });
  }
  return files;
}
