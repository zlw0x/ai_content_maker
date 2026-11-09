"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getProductCardExample, productCardStyles as styles } from "@/lib/product-card-examples";
import { createProductCardRecipe, ProductCardInputError, productCardRecipe } from "@/lib/product-card-recipe";

export function ProductCardMaker({ exampleId }: { exampleId?: string }) {
  const example = getProductCardExample(exampleId);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(example?.title ?? "");
  const [benefit, setBenefit] = useState(example?.benefit ?? "");
  const [styleIndex, setStyleIndex] = useState(example?.styleIndex ?? 0);
  const [runRecipe] = useState(createProductCardRecipe);
  const [result, setResult] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { filename, width, height } = productCardRecipe.output;

  useEffect(() => {
    if (!result) return;
    const url = URL.createObjectURL(result);
    setPreview({ blob: result, url });
    return () => URL.revokeObjectURL(url);
  }, [result]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      setResult(await runRecipe({
        source: file ? { file } : example ? { exampleId: example.id } : null,
        title,
        benefit,
        styleId: styles[styleIndex].id,
      }));
    } catch (error) {
      setError(error instanceof ProductCardInputError ? error.message :
        "Не удалось собрать карточку. Попробуйте открыть другое фото.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="generation-panel">
      <div className="generation-heading"><h2>Собрать карточку</h2><span className="demo-chip">{width} × {height}</span></div>
      <form onSubmit={create} onChange={() => { setResult(null); setPreview(null); setError(""); }}>
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
      {result && preview?.blob === result && <div className="product-card-result">
        {/* The preview is a local blob URL. */}
        <img src={preview.url} alt="Готовая карточка товара" width={width} height={height} />
        <a className="button button-secondary" href={preview.url} download={filename}>Скачать PNG</a>
      </div>}
    </div>
  );
}
