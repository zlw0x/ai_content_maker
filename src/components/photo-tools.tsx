"use client";

import { useEffect, useState, type FormEvent } from "react";
import { maxOutputSide, photoFormats, PhotoToolsError, processPhoto, type PhotoFormat, type PhotoOperation } from "@/lib/photo-tools";
import { trackRecipeFunnel } from "@/lib/recipe-funnel-client";

const presets = [
  { label: "Квадрат · 1:1", width: "1080", height: "1080" },
  { label: "Вертикаль · 3:4", width: "1200", height: "1600" },
  { label: "Горизонталь · 16:9", width: "1280", height: "720" },
];

type Result = Awaited<ReturnType<typeof processPhoto>>;

export function PhotoTools({ funnelEnabled }: { funnelEnabled: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [operation, setOperation] = useState<PhotoOperation>("fit");
  const [width, setWidth] = useState(presets[1].width);
  const [height, setHeight] = useState(presets[1].height);
  const [format, setFormat] = useState<PhotoFormat>("image/png");
  const [result, setResult] = useState<Result | null>(null);
  const [preview, setPreview] = useState<{ result: Result; url: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const presetIndex = presets.findIndex(preset => preset.width === width && preset.height === height);
  const { label, extension } = photoFormats[format];

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    setPreview({ result, url });
    return () => URL.revokeObjectURL(url);
  }, [result]);

  function clearResult() {
    setResult(null);
    setPreview(null);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file) return;
    trackRecipeFunnel(funnelEnabled, "start");
    clearResult();
    setBusy(true);
    try {
      setResult(await processPhoto(file, { width: Number(width), height: Number(height), operation, format }));
    } catch (error) {
      setError(error instanceof PhotoToolsError ? error.message : "Не удалось обработать фото. Попробуйте другой файл или размер.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="generation-panel">
      <div className="generation-heading"><h2>Подготовить фото</h2><span className="demo-chip">Бесплатно</span></div>
      <form onSubmit={submit} onChange={clearResult}>
        <fieldset className="product-card-fields" disabled={!ready || busy}>
          <div className="form-field">
            <label htmlFor="photo-tools-file">Исходное фото</label>
            <div className="upload-box">
              <span aria-hidden="true">↑</span><span>{file?.name ?? "Выберите фотографию"}</span>
              <small id="photo-tools-limits">PNG, JPEG, WebP · до 10 МБ и 24 Мп</small>
              <input id="photo-tools-file" type="file" accept="image/png,image/jpeg,image/webp" required
                aria-describedby="photo-tools-limits" onChange={event => setFile(event.target.files?.[0] ?? null)} />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="photo-tools-operation">Действие</label>
            <select id="photo-tools-operation" value={operation} onChange={event => setOperation(event.target.value as PhotoOperation)}>
              <option value="fit">Изменить размер с сохранением пропорций</option>
              <option value="crop">Кадрировать по центру до точного размера</option>
              <option value="original">Только сменить формат</option>
            </select>
          </div>
          {operation !== "original" && <>
            <div className="form-field">
              <label htmlFor="photo-tools-preset">Размер заготовки</label>
              <select id="photo-tools-preset" value={presetIndex} onChange={event => {
                const preset = presets[Number(event.target.value)];
                setWidth(preset.width);
                setHeight(preset.height);
              }}>
                {presets.map((preset, index) => <option key={preset.label} value={index}>
                  {preset.label} · {preset.width} × {preset.height}
                </option>)}
                <option value={-1} disabled>Свой размер</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="photo-tools-width">Ширина, пиксели</label>
              <input id="photo-tools-width" type="number" min={1} max={maxOutputSide} step={1} required
                value={width} onChange={event => setWidth(event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="photo-tools-height">Высота, пиксели</label>
              <input id="photo-tools-height" type="number" min={1} max={maxOutputSide} step={1} required
                value={height} onChange={event => setHeight(event.target.value)} />
            </div>
          </>}
          <div className="form-field">
            <label htmlFor="photo-tools-format">Формат файла</label>
            <select id="photo-tools-format" value={format} onChange={event => setFormat(event.target.value as PhotoFormat)}>
              {Object.entries(photoFormats).map(([mime, item]) => <option key={mime} value={mime}>{item.label}</option>)}
            </select>
            {format === "image/jpeg" && <p className="small-note">Прозрачные области станут белыми.</p>}
          </div>
          <button type="submit" className="button button-primary generate-button">{busy ? "Обрабатываем…" : "Подготовить фото"}</button>
        </fieldset>
      </form>
      <p className="disabled-note">Фото остаётся в браузере. Готовый файл можно скачать без водяных знаков.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      {result && preview?.result === result && <div className="product-card-result">
        <img src={preview.url} alt="Обработанное фото" width={result.width} height={result.height} />
        <p role="status" className="small-note">{result.width} × {result.height} · {label}</p>
        <a className="button button-secondary" href={preview.url} download={`photo.${extension}`} onClick={() => trackRecipeFunnel(funnelEnabled, "free_export")}>Скачать {label}</a>
      </div>}
    </div>
  );
}
