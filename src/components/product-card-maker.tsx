"use client";

import { useEffect, useState, type FormEvent } from "react";

const styles = [
  { label: "Минимализм", paper: "#f2eee8", photo: "#fff", ink: "#211e1a", accent: "#5e4b40" },
  { label: "Яркий акцент", paper: "#f8dc54", photo: "#fff3b4", ink: "#261f37", accent: "#64368d" },
  { label: "Тёмная витрина", paper: "#1b2330", photo: "#293648", ink: "#f8f5ee", accent: "#8ae2ca" },
];
const width = 1200;
const height = 1600;
const margin = 72;
const contentWidth = width - margin * 2;

async function makeCard(file: File, title: string, benefit: string, style: typeof styles[number]) {
  const image = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Браузер не поддерживает сборку карточки");
    ctx.fillStyle = style.paper;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = style.photo;
    ctx.fillRect(margin, margin, contentWidth, 1040);
    const scale = Math.min((contentWidth - 72) / image.width, 968 / image.height);
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;
    ctx.drawImage(image, (width - imageWidth) / 2, margin + (1040 - imageHeight) / 2, imageWidth, imageHeight);

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

export function ProductCardMaker() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [benefit, setBenefit] = useState("");
  const [styleIndex, setStyleIndex] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (result) return () => URL.revokeObjectURL(result);
  }, [result]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setResult(null);
    setError("");
    if (!file || file.size === 0 || file.size > 10 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Выберите фото в формате PNG, JPG или WebP размером до 10 МБ.");
      return;
    }
    if (!title.trim()) {
      setError("Введите название товара.");
      return;
    }
    setBusy(true);
    try {
      const png = await makeCard(file, title.trim(), benefit.trim().replace(/\s+/g, " "), styles[styleIndex]);
      setResult(URL.createObjectURL(png));
    } catch {
      setError("Не удалось собрать карточку. Попробуйте открыть другое фото.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="generation-panel">
      <div className="generation-heading"><h2>Собрать карточку</h2><span className="demo-chip">1200 × 1600</span></div>
      <form onSubmit={create} onChange={() => { setResult(null); setError(""); }}>
        <fieldset className="product-card-fields" disabled={busy}>
          <div className="form-field">
            <label htmlFor="product-photo">Фото товара</label>
            <div className="upload-box">
              <span aria-hidden="true">↑</span><span>{file?.name ?? "Выберите фотографию"}</span>
              <small>PNG, JPG, WebP · до 10 МБ</small>
              <input id="product-photo" type="file" accept="image/png,image/jpeg,image/webp" required
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="product-title">Название товара</label>
            <input id="product-title" value={title} required maxLength={64} placeholder="Термокружка"
              onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="product-benefit">Преимущество (необязательно)</label>
            <input id="product-benefit" value={benefit} maxLength={55} placeholder="Держит тепло до 8 часов"
              onChange={e => setBenefit(e.target.value)} />
          </div>
          <div className="form-field">
            <label htmlFor="product-style">Оформление</label>
            <select id="product-style" value={styleIndex} onChange={e => setStyleIndex(Number(e.target.value))}>
              {styles.map((style, index) => <option key={style.label} value={index}>{style.label}</option>)}
            </select>
          </div>
          <button type="submit" className="button button-primary generate-button">
            {busy ? "Собираем…" : "Создать карточку"}
          </button>
        </fieldset>
      </form>
      <p className="disabled-note">Фото остаётся в браузере. Карточка собирается бесплатно и сохраняется как PNG.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      {result && <div className="product-card-result">
        {/* The preview is a local blob URL. */}
        <img src={result} alt="Готовая карточка товара" width={width} height={height} />
        <a className="button button-secondary" href={result} download="product-card.png">Скачать PNG</a>
      </div>}
    </div>
  );
}
