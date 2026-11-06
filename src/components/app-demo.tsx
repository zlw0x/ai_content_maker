"use client";

import { useState } from "react";
import type { AiApp } from "@/lib/catalog";

export function AppDemo({ app }: { app: AiApp }) {
  const [prompt, setPrompt] = useState("");
  const [fileName, setFileName] = useState("");
  const [quality, setQuality] = useState("720p");
  const [duration, setDuration] = useState("5");

  const needsImage = app.mode === "image-prompt" || app.mode === "image-only";
  const needsPrompt = app.mode !== "image-only";
  const isVideo = app.category === "Видео";

  return (
    <div className="generation-panel">
      <div className="generation-heading">
        <h2>Настройки</h2>
        <span className="demo-chip">Прототип</span>
      </div>
      {needsImage && (
        <div className="form-field">
          <label htmlFor="demo-file">Исходное изображение</label>
          <div className="upload-box">
            <span aria-hidden="true">↑</span>
            <span>{fileName || "Выбрать фотографию"}</span>
            <small>Файл остаётся в браузере. В демо он не загружается на сервер.</small>
            <input
              id="demo-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
            />
          </div>
        </div>
      )}
      {needsPrompt && (
        <div className="form-field">
          <label htmlFor="prompt">{app.mode === "voice" ? "Текст для озвучки" : "Опиши желаемый результат"}</label>
          <textarea
            id="prompt"
            value={prompt}
            maxLength={2000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={app.examples[0]}
            rows={5}
          />
          <span className="field-help">{prompt.length} / 2000 символов</span>
        </div>
      )}
      {isVideo && (
        <div className="form-columns">
          <div className="form-field">
            <label htmlFor="quality">Качество</label>
            <select id="quality" value={quality} onChange={(event) => setQuality(event.target.value)}>
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="duration">Длительность</label>
            <select id="duration" value={duration} onChange={(event) => setDuration(event.target.value)}>
              <option value="5">5 сек</option>
              <option value="10">10 сек</option>
            </select>
          </div>
        </div>
      )}
      <div className="price-summary">
        <div><strong>{app.demoStartingPrice === null ? "Уточняется" : "от " + app.demoStartingPrice + " ₽"}</strong><span>Предварительная стоимость</span></div>
        <small>Точная цена появится после подключения тарифов API.</small>
      </div>
      <button className="button button-primary generate-button" type="button" disabled>Генерация пока недоступна</button>
      <p className="disabled-note">Демо UI: нет загрузки на сервер, платежей и вызовов WaveSpeed.</p>
    </div>
  );
}
