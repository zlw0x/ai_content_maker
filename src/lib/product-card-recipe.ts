import { getProductCardExample, productCardStyles } from "./product-card-examples";
import { cardHeight, cardWidth, makeProductCard } from "./render-product-card";

export const productCardRecipe = {
  key: "product-card",
  version: 2,
  output: { filename: "product-card.png", width: cardWidth, height: cardHeight },
} as const;

type ProductCardInput = {
  source: { file: File } | { exampleId: string } | null;
  title: string;
  benefit: string;
  price?: string;
  frame?: boolean;
  styleId: typeof productCardStyles[number]["id"];
};

export class ProductCardInputError extends Error {}

async function loadPhoto(source: File | string): Promise<Blob> {
  if (typeof source !== "string") return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error("Не удалось загрузить фото примера");
  return response.blob();
}

export function createProductCardRecipe(render = makeProductCard) {
  // Keep at most one run per editor. File identity distinguishes separate uploads.
  let lastRun: { source: File | string; key: string; png: Promise<Blob> } | undefined;

  return async function run(input: ProductCardInput): Promise<Blob> {
    const source = input.source;
    const file = source && "file" in source ? source.file : null;
    if (file && (file.size === 0 || file.size > 10 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      throw new ProductCardInputError("Выберите фото в формате PNG, JPG или WebP размером до 10 МБ.");
    }
    const title = input.title.trim();
    if (!title) throw new ProductCardInputError("Введите название товара.");

    const photo = file ?? (source && "exampleId" in source ? getProductCardExample(source.exampleId)?.beforeUrl : undefined);
    if (!photo) throw new ProductCardInputError("Выберите фото товара.");
    const style = productCardStyles.find(option => option.id === input.styleId);
    if (!style) throw new ProductCardInputError("Выберите оформление карточки.");
    const benefit = input.benefit.trim().replace(/\s+/g, " ");
    const price = input.price?.trim().replace(/\s+/g, " ") ?? "";
    if (price.length > 24) throw new ProductCardInputError("Цена на макете должна быть не длиннее 24 символов.");
    const frame = input.frame === true;
    const key = JSON.stringify([productCardRecipe.key, productCardRecipe.version, title, benefit, style.id, price, frame]);
    if (lastRun?.source === photo && lastRun.key === key) return lastRun.png;

    const png = loadPhoto(photo).then(blob => render(blob, title, benefit, style, { price, frame }));
    lastRun = { source: photo, key, png };
    try {
      return await png;
    } catch (error) {
      if (lastRun?.png === png) lastRun = undefined;
      throw error;
    }
  };
}
