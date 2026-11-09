export const photoFormats = {
  "image/png": { label: "PNG", extension: "png" },
  "image/jpeg": { label: "JPEG", extension: "jpg" },
  "image/webp": { label: "WebP", extension: "webp" },
} as const;

export type PhotoFormat = keyof typeof photoFormats;
export type PhotoOperation = "original" | "fit" | "crop";

type Size = { width: number; height: number };
type PhotoHeader = Size & { format: PhotoFormat };
type PhotoOptions = Size & { format: PhotoFormat; operation: PhotoOperation };

export const maxOutputSide = 4096;
const maxInputBytes = 10 * 1024 * 1024;
const maxInputPixels = 24_000_000;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export class PhotoToolsError extends Error {}

function jpegSize(bytes: Uint8Array, view: DataView): Size | undefined {
  let offset = 2;
  while (offset < bytes.length && bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return;
    // SOF markers carry the dimensions. DHT, JPG and DAC use adjacent codes.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return;
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += length;
  }
}

function webpSize(bytes: Uint8Array, view: DataView): Size | undefined {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  const chunkSize = view.getUint32(16, true);
  if (20 + chunkSize > bytes.length || view.getUint32(4, true) + 8 > bytes.length) return;
  if (chunk === "VP8X" && chunkSize >= 10) {
    return {
      width: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
      height: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536,
    };
  }
  if (chunk === "VP8L" && chunkSize >= 5 && bytes[20] === 0x2f) {
    const dimensions = view.getUint32(21, true);
    return { width: 1 + (dimensions & 0x3fff), height: 1 + ((dimensions >>> 14) & 0x3fff) };
  }
  if (chunk === "VP8 " && chunkSize >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
}

function readHeader(buffer: ArrayBuffer): PhotoHeader | undefined {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length >= 33 && pngSignature.every((byte, index) => bytes[index] === byte) &&
      view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    return { format: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = jpegSize(bytes, view);
    return size && { format: "image/jpeg", ...size };
  }
  if (bytes.length >= 20 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const size = webpSize(bytes, view);
    return size && { format: "image/webp", ...size };
  }
}

function checkInputSize({ width, height }: Size) {
  if (width < 1 || height < 1 || width > 12_000 || height > 12_000 || width * height > maxInputPixels) {
    throw new PhotoToolsError("Выберите фото до 24 мегапикселей и до 12 000 пикселей на сторону.");
  }
}

function checkOutputSize({ width, height }: Size) {
  if (![width, height].every(side => Number.isInteger(side) && side >= 1 && side <= maxOutputSide)) {
    throw new PhotoToolsError("Выберите изменение размера или кадрирование и укажите от 1 до 4096 пикселей на сторону.");
  }
}

export async function processPhoto(file: File, options: PhotoOptions) {
  if (file.size === 0 || file.size > maxInputBytes) {
    throw new PhotoToolsError("Выберите файл размером до 10 МБ.");
  }
  if (options.operation !== "original") checkOutputSize(options);
  // Read dimensions before decoding to bound memory even for a small compressed file.
  const header = readHeader(await file.arrayBuffer());
  if (!header) throw new PhotoToolsError("Выберите корректное изображение в формате PNG, JPEG или WebP.");
  checkInputSize(header);

  const image = await createImageBitmap(file.slice(0, file.size, header.format)).catch(() => {
    throw new PhotoToolsError("Не удалось открыть изображение. Выберите другой файл.");
  });
  const canvas = document.createElement("canvas");
  try {
    try {
      checkInputSize(image);
      const fitScale = options.operation === "fit" ? Math.min(options.width / image.width, options.height / image.height) : 1;
      const width = options.operation === "crop" ? options.width : Math.max(1, Math.round(image.width * fitScale));
      const height = options.operation === "crop" ? options.height : Math.max(1, Math.round(image.height * fitScale));
      checkOutputSize({ width, height });
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new PhotoToolsError("Этот браузер не поддерживает обработку фото.");
      if (options.format === "image/jpeg") {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
      }
      context.imageSmoothingQuality = "high";
      const coverScale = options.operation === "crop" ? Math.max(width / image.width, height / image.height) : 1;
      const sourceWidth = options.operation === "crop" ? Math.min(image.width, width / coverScale) : image.width;
      const sourceHeight = options.operation === "crop" ? Math.min(image.height, height / coverScale) : image.height;
      context.drawImage(image, (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2,
        sourceWidth, sourceHeight, 0, 0, width, height);
    } finally {
      image.close();
    }

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, options.format, 0.92));
    if (!blob || blob.type !== options.format) {
      throw new PhotoToolsError("Браузер не смог сохранить фото в выбранном формате. Выберите другой формат.");
    }
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = 0;
  }
}
