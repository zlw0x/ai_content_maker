import type { productCardStyles } from "./product-card-examples";

export const cardWidth = 1200;
export const cardHeight = 1600;
const margin = 72;
const contentWidth = cardWidth - margin * 2;

export async function makeProductCard(file: Blob, title: string, benefit: string, style: typeof productCardStyles[number]) {
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = cardWidth;
  canvas.height = cardHeight;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Браузер не поддерживает сборку карточки");
    ctx.fillStyle = style.paper;
    ctx.fillRect(0, 0, cardWidth, cardHeight);
    ctx.fillStyle = style.photo;
    ctx.fillRect(margin, margin, contentWidth, 1040);
    const scale = Math.min((contentWidth - 72) / image.width, 968 / image.height);
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;
    ctx.drawImage(image, (cardWidth - imageWidth) / 2, margin + (1040 - imageHeight) / 2, imageWidth, imageHeight);

    ctx.fillStyle = style.accent;
    ctx.fillRect(margin, 1178, 100, 9);
    ctx.textBaseline = "top";
    ctx.font = "700 88px system-ui, sans-serif";
    ctx.fillStyle = style.ink;
    const words = title.split(/\s+/);
    let firstLine = words.shift()!;
    while (words.length && ctx.measureText(firstLine + " " + words[0]).width <= contentWidth) {
      firstLine += " " + words.shift();
    }
    ctx.fillText(firstLine, margin, 1220, contentWidth);
    if (words.length) ctx.fillText(words.join(" "), margin, 1320, contentWidth);
    if (benefit) {
      ctx.fillStyle = style.accent;
      ctx.font = "600 44px system-ui, sans-serif";
      ctx.fillText(benefit, margin, words.length ? 1450 : 1350, contentWidth);
    }
  } finally {
    image.close();
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Не удалось сохранить PNG")), "image/png");
  });
}
