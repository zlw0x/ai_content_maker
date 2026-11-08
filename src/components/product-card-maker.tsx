"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getProductCardExample, productCardStyles as styles } from "@/lib/product-card-examples";
import { cardHeight, cardWidth, makeProductCard } from "@/lib/render-product-card";

export function ProductCardMaker({ exampleId }: { exampleId?: string }) {
  const example = getProductCardExample(exampleId);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(example?.title ?? "");
  const [benefit, setBenefit] = useState(example?.benefit ?? "");
  const [styleIndex, setStyleIndex] = useState(example?.styleIndex ?? 0);
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
    if (file && (file.size === 0 || file.size > 10 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
      setError("Выберите фото в формате PNG, JPG или WebP размером до 10 МБ.");
      return;
    }
    if (!title.trim()) {
      setError("Введите название товара.");
      return;
    }
    setBusy(true);
    try {
      let source: Blob | null = file;
      if (!source && example) {
        const response = await fetch(example.beforeUrl);
        if (!response.ok) throw new Error("Не удалось загрузить фото примера");
        source = await response.blob();
      }
      if (!source) throw new Error("Фото товара обязательно");
      const png = await makeProductCard(source, title.trim(), benefit.trim().replace(/\s+/g, " "), styles[styleIndex]);
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
              <span aria-hidden="true">↑</span><span>{file?.name ?? (example ? "Фото из примера" : "Выберите фотографию")}</span>
              <small>PNG, JPG, WebP · до 10 МБ</small>
              <input id="product-photo" type="file" accept="image/png,image/jpeg,image/webp" required={!example}
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
        <img src={result} alt="Готовая карточка товара" width={cardWidth} height={cardHeight} />
        <a className="button button-secondary" href={result} download="product-card.png">Скачать PNG</a>
      </div>}
    </div>
  );
}
