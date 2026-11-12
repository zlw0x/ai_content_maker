"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, rub } from "@/lib/api-client";
import { PhotoToolsError, processPhoto } from "@/lib/photo-tools";
import { takeRecipeHandoff } from "@/lib/recipe-handoff";
import { recipeFunnelVisit, trackRecipeFunnel } from "@/lib/recipe-funnel-client";
import type { getRecipeExample } from "@/lib/recipe-showcase";
import { isRecipeKey, recipeCatalog, type RecipeKey, type RecipeLayout } from "@/lib/recipes";
import styles from "./recipe-studio.module.css";

type Access = "trial" | "premium";
type Availability = {
  enabled: boolean;
  trialEnabled: boolean;
  verified: boolean;
  trialState: "available" | "reserved" | "used";
  mock: boolean;
  paymentMode: "disabled" | "mock" | "yookassa-test";
};
type Quote = { id: string; priceKopecks: number; currency: "RUB"; expiresAt: string };
type ActiveQuote = Quote & { requestKey: string; expired: boolean; attempted: boolean };
type Order = {
  id: string;
  status: string;
  priceKopecks: number;
  layout: RecipeLayout;
  revision: number;
  errorCode: string | null;
  expiresAt: string;
  recipeKey: RecipeKey;
  version: number;
  access: Access;
  mock: boolean;
  canReuseCutout: boolean;
  files: { id: string; filename: string; url: string }[];
};
type PaymentStatus = "pending" | "succeeded" | "canceled" | "unknown";
type Payment = {
  mode: "mock" | "yookassa-test";
  status: PaymentStatus;
  confirmationUrl: string | null;
  refundStatus: PaymentStatus | null;
};

const initialLayout: RecipeLayout = { title: "", benefit: "", price: "", color: "#74529f", alignment: "left" };
const processingStatuses = new Set(["queued", "preparing", "submitting", "processing"]);
const orderStatuses: Record<string, string> = {
  awaiting_payment: "Ожидает оплаты", queued: "В очереди", preparing: "Готовим фото", submitting: "Передаём фото на обработку",
  processing: "Создаём материалы", completed: "Готово", failed: "Обработка завершилась ошибкой", unknown: "Нужна сверка результата",
};
const paymentStatuses: Record<PaymentStatus, string> = {
  pending: "Платёж ожидает подтверждения", succeeded: "Платёж подтверждён", canceled: "Платёж отменён", unknown: "Платёж требует сверки",
};
const refundStatuses: Record<PaymentStatus, string> = {
  pending: "Возврат обрабатывается", succeeded: "Возврат подтверждён", canceled: "Возврат отменён", unknown: "Возврат требует сверки",
};

function message(error: unknown, fallback = "Не удалось связаться с сервером. Попробуйте ещё раз.") {
  return error instanceof ApiError || error instanceof PhotoToolsError ? error.message : fallback;
}

function orderPath(id: string, recipeKey: RecipeKey) {
  return "/apps/recipes?" + new URLSearchParams({ recipe: recipeKey, order: id });
}

function post<T>(path: string, body: object = {}, headers?: Record<string, string>) {
  return api<T>(path, { method: "POST", body: JSON.stringify(body), headers });
}

function LayoutFields({ layout, onChange }: { layout: RecipeLayout; onChange: (layout: RecipeLayout) => void }) {
  return <div className={styles.layoutFields}>
    <div className={styles.wide}>
      <label htmlFor="recipe-title">Название товара</label>
      <input id="recipe-title" required maxLength={64} placeholder="Керамическая кружка" value={layout.title}
        onChange={event => onChange({ ...layout, title: event.target.value })} />
    </div>
    <div className={styles.wide}>
      <label htmlFor="recipe-benefit">Преимущество</label>
      <input id="recipe-benefit" maxLength={80} placeholder="Ручная работа" value={layout.benefit}
        onChange={event => onChange({ ...layout, benefit: event.target.value })} />
    </div>
    <div>
      <label htmlFor="recipe-price">Цена на макете</label>
      <input id="recipe-price" maxLength={24} placeholder="1 290 ₽" value={layout.price}
        onChange={event => onChange({ ...layout, price: event.target.value })} />
    </div>
    <div>
      <label htmlFor="recipe-color">Цвет акцента</label>
      <input id="recipe-color" type="color" value={layout.color}
        onChange={event => onChange({ ...layout, color: event.target.value })} />
    </div>
    <div className={styles.wide}>
      <label htmlFor="recipe-frame">Рамка вокруг фото</label>
      <select id="recipe-frame" value={layout.frame ? "line" : "none"}
        onChange={event => onChange({ ...layout, frame: event.target.value === "line" ? true : undefined })}>
        <option value="none">Без рамки</option><option value="line">Тонкая рамка</option>
      </select>
    </div>
    <div className={styles.wide}>
      <label htmlFor="recipe-alignment">Выравнивание текста</label>
      <select id="recipe-alignment" value={layout.alignment}
        onChange={event => onChange({ ...layout, alignment: event.target.value as RecipeLayout["alignment"] })}>
        <option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option>
      </select>
    </div>
  </div>;
}

function VerifyEmail({ onVerified }: { onVerified: () => void }) {
  const [delivery, setDelivery] = useState<{ delivery: "mock" | "email"; demoCode?: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode() {
    setError("");
    setBusy(true);
    try {
      setDelivery(await post("/auth/verify-email/start"));
      setCode("");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await post("/auth/verify-email/confirm", { code });
      onVerified();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <p>Подтвердите почту, чтобы получить одну пробную обработку.</p>
    {delivery && <form onSubmit={confirm}>
      <fieldset disabled={busy} className={styles.fields}>
        <p className={styles.hint}>{delivery.delivery === "mock" ? `Тестовый код · ${delivery.demoCode ?? "уточните в настройках теста"}` : "Код отправлен на вашу почту."}</p>
        <label htmlFor="recipe-email-code">Код подтверждения</label>
        <input id="recipe-email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6}
          value={code} onChange={event => setCode(event.target.value)} />
        <div className={styles.actions}><button type="submit" className="button button-primary">Подтвердить почту</button></div>
      </fieldset>
    </form>}
    <div className={styles.actions}>
      <button type="button" className="button button-secondary" onClick={sendCode} disabled={busy}>
        {delivery ? "Отправить новый код" : "Получить код"}
      </button>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}

type ShowcaseExample = ReturnType<typeof getRecipeExample>;
const cutoutUnavailable = "Готовое фото недоступно. Выберите исходное фото заново.";

export function RecipeStudio({ initialRecipe, orderId, handoff, reuse, example, funnelEnabled }: {
  initialRecipe: RecipeKey; orderId?: string; handoff?: string; reuse?: string; example?: ShowcaseExample; funnelEnabled: boolean;
}) {
  const [settings, setSettings] = useState<Availability | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSettingsError("");
    api<Availability>("/recipe-availability", { signal: controller.signal }).then(setSettings).catch(error => {
      if (!controller.signal.aborted) setSettingsError(message(error));
    });
    return () => controller.abort();
  }, [reload]);

  if (orderId) return <RecipeOrder orderId={orderId} settings={settings} />;
  if (!settings) return <section className={styles.panel} aria-label="Доступность студии">
    {settingsError ? <>
      <p role="alert" className="form-error">{settingsError}</p>
      <button type="button" className="button button-secondary" onClick={() => setReload(value => value + 1)}>Проверить доступность</button>
    </> : <p role="status">Проверяем доступность студии…</p>}
  </section>;
  if (!settings.enabled) return <section className={styles.panel} aria-label="Доступность студии">
    <h2>Студия временно закрыта</h2>
    <p>Бесплатные инструменты уже доступны в браузере.</p>
    <div className={styles.actions}><Link className="button button-primary" href="/apps/product-card">Собрать карточку</Link>
      <Link className="button button-secondary" href="/apps/photo-tools">Подготовить фото</Link></div>
  </section>;

  return <RecipeWizard key={handoff} initialRecipe={initialRecipe} settings={settings} handoff={handoff} reuse={reuse} example={example} funnelEnabled={funnelEnabled}
    onVerified={() => setSettings(current => current && { ...current, verified: true })} />;
}

function RecipeWizard({ initialRecipe, settings, handoff, reuse, example, funnelEnabled, onVerified }: {
  initialRecipe: RecipeKey; settings: Availability; handoff?: string; reuse?: string; example?: ShowcaseExample; funnelEnabled: boolean; onVerified: () => void;
}) {
  const [recipeKey, setRecipeKey] = useState(initialRecipe);
  const [accessChoice, setAccessChoice] = useState<Access | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [layout, setLayout] = useState<RecipeLayout>(example?.layout ?? initialLayout);
  const [quote, setQuote] = useState<ActiveQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handoffMissing, setHandoffMissing] = useState(false);
  const [cutout, setCutout] = useState<{ orderId: string; previewUrl: string } | null>(null);
  const [reuseMessage, setReuseMessage] = useState("");
  const checkedHandoff = useRef(false);
  const replacedSource = useRef(false);
  const uploaded = useRef<{ file: File; id: string } | null>(null);
  const recipe = recipeCatalog[recipeKey];
  const trialPossible = recipe.trial && settings.trialEnabled;
  const access = trialPossible && (accessChoice === "trial" || (accessChoice === null && settings.trialState === "available")) ? "trial" : "premium";
  const verify = access === "trial" && settings.trialState === "available" && !settings.verified;
  const accessAvailable = access === "trial" ? settings.verified && settings.trialState === "available" : settings.paymentMode !== "disabled";
  const reusableSource = access === "premium" && !recipe.trial ? cutout : null;
  const ready = Boolean(reusableSource || (file && preview?.file === file));

  useEffect(() => {
    if (!handoff || checkedHandoff.current) return;
    checkedHandoff.current = true;
    const source = takeRecipeHandoff(handoff);
    if (!source) { setHandoffMissing(true); return; }
    setFile(source.file);
    setLayout({ ...initialLayout, title: source.title, benefit: source.benefit, price: source.price, frame: source.frame });
  }, [handoff]);

  useEffect(() => {
    if (!reuse) return;
    const controller = new AbortController();
    api<Order>(`/recipe-orders/${reuse}`, { signal: controller.signal }).then(order => {
      if (controller.signal.aborted || replacedSource.current) return;
      const image = order.files[0];
      if (!order.canReuseCutout || !image) { setReuseMessage(cutoutUnavailable); return; }
      const previewUrl = new URL(image.url, window.location.origin);
      previewUrl.searchParams.set("view", "1");
      setCutout({ orderId: order.id, previewUrl: previewUrl.href });
    }).catch(() => {
      if (!controller.signal.aborted && !replacedSource.current) setReuseMessage(cutoutUnavailable);
    });
    return () => controller.abort();
  }, [reuse]);

  useEffect(() => {
    if (!example) return;
    const controller = new AbortController();
    fetch(example.beforeUrl, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error("Исходник примера недоступен. Выберите своё фото.");
      return response.blob();
    }).then(blob => {
      if (!controller.signal.aborted) setFile(current => current ?? new File([blob], `${example.id}.png`, { type: "image/png" }));
    }).catch(error => { if (!controller.signal.aborted) setError(message(error)); });
    return () => controller.abort();
  }, [example]);

  useEffect(() => {
    if (!file) return;
    let active = true;
    let url: string | undefined;
    processPhoto(file, { operation: "fit", width: 240, height: 240, format: "image/png" }).then(({ blob }) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPreview({ file, url });
    }).catch(error => {
      if (active) setError(message(error, "Не удалось открыть фото. Выберите другой файл."));
    });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  useEffect(() => {
    if (!quote || quote.expired) return;
    const timer = window.setTimeout(() => {
      setQuote(current => current?.id === quote.id ? { ...current, expired: true } : current);
    }, Math.max(0, new Date(quote.expiresAt).getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quote]);

  function invalidate() {
    setQuote(null);
    setError("");
  }

  async function requestQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !accessAvailable || busy) return;
    trackRecipeFunnel(funnelEnabled, "start");
    invalidate();
    setBusy(true);
    try {
      let source: { sourceOrderId: string } | { assetId: string };
      if (reusableSource) {
        source = { sourceOrderId: reusableSource.orderId };
      } else {
        if (!file) return;
        let assetId = uploaded.current?.file === file ? uploaded.current.id : undefined;
        if (!assetId) {
          const body = new FormData();
          body.append("file", file);
          const asset = await api<{ id: string }>("/assets", { method: "POST", body });
          assetId = asset.id;
          uploaded.current = { file, id: assetId };
        }
        source = { assetId };
      }
      const visitId = recipeFunnelVisit(funnelEnabled);
      const response = await post<Quote>("/recipe-quotes", { recipeKey, ...source, access, layout }, visitId ? { "X-Recipe-Funnel-Visit": visitId } : undefined);
      setQuote({ ...response, requestKey: crypto.randomUUID(), expired: false, attempted: false });
    } catch (error) {
      if (error instanceof ApiError && error.code === "FILE_NOT_FOUND") uploaded.current = null;
      if (reusableSource && error instanceof ApiError && error.status === 404) setCutout(null);
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitOrder() {
    if (!quote || busy || (!quote.attempted && quote.expired)) return;
    setQuote({ ...quote, attempted: true });
    setError("");
    setBusy(true);
    try {
      const order = await post<{ id: string }>("/recipe-orders", { quoteId: quote.id }, { "Idempotency-Key": quote.requestKey });
      window.location.assign(orderPath(order.id, recipeKey));
    } catch (error) {
      if (reusableSource && error instanceof ApiError && error.code === "FILE_NOT_FOUND") {
        setCutout(null);
        setQuote(null);
      } else if (error instanceof ApiError && error.code === "RECIPE_QUOTE_EXPIRED") setQuote(null);
      else if (error instanceof ApiError && error.status < 500) {
        setQuote(current => current && { ...current, attempted: false });
      }
      setError(message(error));
      setBusy(false);
    }
  }

  return <div className={styles.shell}>
    <section className={styles.panel} aria-labelledby="recipe-form-title">
      <h2 id="recipe-form-title">Подготовить заказ</h2>
      <ol className={styles.steps} aria-label="Шаги заказа">
        <li aria-current={!ready ? "step" : undefined}>1. Исходник</li>
        <li aria-current={ready && !quote ? "step" : undefined}>2. Настройки</li>
        <li aria-current={quote ? "step" : undefined}>3. Подтверждение</li>
      </ol>
      <form onSubmit={requestQuote} onChange={invalidate}>
        <fieldset disabled={busy || quote?.attempted} className={`${styles.fields} ${styles.stack}`}>
          <div>
            <label htmlFor="recipe-choice">Что подготовить</label>
            <select id="recipe-choice" value={recipeKey} onChange={event => {
              const key = event.target.value;
              if (isRecipeKey(key)) { setRecipeKey(key); setAccessChoice(null); }
            }}>
              {Object.entries(recipeCatalog).map(([key, item]) => <option value={key} key={key}>{item.title}</option>)}
            </select>
            <p className={styles.hint}>{recipe.summary}</p>
          </div>
          {trialPossible && <div>
            <label htmlFor="recipe-access">Способ запуска</label>
            <select id="recipe-access" value={access} onChange={event => setAccessChoice(event.target.value as Access)}>
              <option value="trial">AI Trial · одна пробная обработка</option><option value="premium">Premium · тестовый заказ</option>
            </select>
          </div>}
          <div>
            <label htmlFor="recipe-photo">Исходное фото</label>
            <div className="upload-box">
              <span aria-hidden="true">↑</span><span>{file?.name ?? (cutout ? "Выбрать другое фото" : "Выберите изображение")}</span>
              <small id="recipe-photo-formats">PNG, JPEG или WebP · до 10 МБ</small>
              <input id="recipe-photo" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="recipe-photo-formats" required={!file && !reusableSource}
                onChange={event => {
                  replacedSource.current = true;
                  uploaded.current = null;
                  setPreview(null);
                  setHandoffMissing(false);
                  setCutout(null);
                  setReuseMessage("");
                  setFile(event.target.files?.[0] ?? null);
                }} />
            </div>
            {handoffMissing && <p className={styles.hint}>Исходное фото больше не доступно в этой вкладке. Выберите его заново.</p>}
            {reuseMessage && <p role="status" className={styles.hint}>{reuseMessage}</p>}
            {cutout && <figure className={styles.preview}>
              <img src={cutout.previewUrl} alt="Готовое фото без фона" onError={() => {
                setCutout(null);
                setReuseMessage(cutoutUnavailable);
                invalidate();
              }} />
              <figcaption>{reusableSource ? "Фото без фона из вашей пробной обработки. Студия использует его из личного хранилища." :
                "Это фото можно использовать для карточек и рекламы. Для обработки фото выберите новый файл."}</figcaption>
            </figure>}
            {preview && <figure className={styles.preview}><img src={preview.url} alt="Предпросмотр исходного фото" />
              <figcaption>Фото загружается в личное хранилище при расчёте стоимости.</figcaption></figure>}
          </div>
          {!recipe.trial && <LayoutFields layout={layout} onChange={setLayout} />}
          <button type="submit" className="button button-primary" disabled={!ready || !accessAvailable}>
            {busy ? "Подождите…" : "Рассчитать стоимость"}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
    <aside className={styles.panel} aria-labelledby="recipe-summary-title">
      <p className="section-kicker">{settings.mock ? "Тестовый режим" : access === "trial" ? "AI Trial" : "Premium"}</p>
      <h2 id="recipe-summary-title">{recipe.title}</h2>
      <p>{recipe.summary}</p>
      {verify && <VerifyEmail onVerified={onVerified} />}
      {access === "trial" && settings.trialState !== "available" && <p className={styles.hint}>
        {settings.trialState === "used" ? "Пробная обработка уже использована." : "Пробная обработка уже выполняется или ожидает сверки."}
      </p>}
      {access === "premium" && settings.paymentMode === "disabled" && <p className={styles.hint}>Тестовая оплата сейчас недоступна. Вы можете воспользоваться бесплатными инструментами.</p>}
      {quote && <div>
        <p className={styles.hint}>Стоимость заказа</p>
        <strong className={styles.price} aria-live="polite">{rub(quote.priceKopecks)}</strong>
        <p className={styles.hint}>{quote.expired ? "Срок расчёта истёк." : `Расчёт действует до ${new Date(quote.expiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}.`}</p>
        {quote.attempted && !busy && <p className={styles.hint}>Проверьте этот заказ. Если сервер уже принял его, откроется тот же заказ.</p>}
        <button className="button button-primary" type="button" disabled={busy || (quote.expired && !quote.attempted)} onClick={submitOrder}>
          {quote.attempted && !busy ? "Проверить заказ" : access === "trial" ? "Запустить пробную обработку" : "Продолжить к тестовой оплате"}
        </button>
      </div>}
      <div className={styles.actions}><Link href="/apps/photo-tools" className="button button-secondary">Бесплатная подготовка фото</Link></div>
    </aside>
  </div>;
}

function RecipeOrder({ orderId, settings }: { orderId: string; settings: Availability | null }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [payment, setPayment] = useState<Payment | null>();
  const [editing, setEditing] = useState<{ layout: RecipeLayout; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [reload, setReload] = useState(0);
  const refreshedOnReturn = useRef(false);
  const path = `/recipe-orders/${orderId}`;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function check() {
      try {
        const detail = await api<Order>(path, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setOrder(detail);
        let currentPayment: Payment | null = null;
        if (detail.access === "premium") {
          currentPayment = await api<Payment | null>(`${path}/payment`, { signal: controller.signal });
          if (currentPayment?.mode === "yookassa-test" && currentPayment.status === "pending" && !refreshedOnReturn.current) {
            if (controller.signal.aborted) return;
            setPayment(currentPayment);
            refreshedOnReturn.current = true;
            currentPayment = await api<Payment>(`${path}/refresh-payment`, { method: "POST", body: "{}", signal: controller.signal });
          }
        }
        if (controller.signal.aborted) return;
        setPayment(currentPayment);
        setPollError("");
        const awaitingUpdate = detail.status === "awaiting_payment" && (currentPayment?.status === "pending" || currentPayment?.status === "succeeded");
        if (processingStatuses.has(detail.status) || awaitingUpdate) timer = window.setTimeout(check, 2500);
      } catch (error) {
        if (!controller.signal.aborted) setPollError(message(error));
      }
    }
    void check();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [path, reload]);

  function refresh() { setReload(value => value + 1); }

  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(message(error));
    } finally {
      refresh();
      setBusy(false);
    }
  }

  function updatePayment(action: string, body?: object) {
    void act(async () => setPayment(await post<Payment>(`${path}/${action}`, body)));
  }

  function updateLayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    void act(async () => {
      try {
        const updated = await api<Order>(path, { method: "PATCH", body: JSON.stringify(editing) });
        setOrder(updated);
        setEditing(null);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) setEditing(null);
        throw error;
      }
    });
  }

  if (!order) return <section className={styles.panel} aria-label="Заказ">
    {pollError ? <><p role="alert" className="form-error">{pollError}</p>
      <div className={styles.actions}><button type="button" className="button button-secondary" onClick={refresh}>Повторить проверку</button>
        <Link href="/apps/recipes" className="button button-secondary">К рецептам</Link></div>
    </> : <p role="status">Открываем заказ…</p>}
  </section>;

  const recipe = recipeCatalog[order.recipeKey];
  const canEdit = order.status === "completed" && order.files.length > 0 && !recipe.trial;
  const canPay = order.mock && settings && settings.paymentMode !== "disabled";
  const expired = new Date(order.expiresAt).getTime() <= Date.now();

  return <div className={styles.shell}>
    <section className={styles.panel} aria-labelledby="recipe-result-title">
      <div className={styles.resultHeader}>
        <div><p className="section-kicker">{order.mock ? "Тестовый заказ" : order.access === "trial" ? "AI Trial" : "Заказ"}</p>
          <h2 id="recipe-result-title">{recipe.title}</h2></div>
        <Link className="button button-secondary" href={`/apps/recipes?recipe=${order.recipeKey}`}>Новый заказ</Link>
      </div>
      <p role="status" aria-live="polite">{orderStatuses[order.status] ?? "Статус обновляется"}</p>
      {order.status === "unknown" && <p className={styles.hint}>Статус обработки проверяется. Сохраните эту страницу и обновите статус позже.</p>}
      {order.errorCode && order.status === "failed" && <p className={styles.hint}>Код ошибки: {order.errorCode}</p>}
      {order.status === "completed" && !order.files.length && <p className={styles.hint}>Срок хранения файлов закончился.</p>}
      {order.files.length > 0 && <div className={styles.outputs}>
        {order.files.map((file, index) => <figure className={styles.output} key={file.id}>
          <img src={`${file.url}?view=1`} alt={`Результат ${index + 1}`} loading="lazy" />
          <figcaption><span>{file.filename}</span><a className="button button-secondary" href={file.url} download={file.filename}>Скачать файл {index + 1}</a></figcaption>
        </figure>)}
      </div>}
      {pollError && <p role="alert" className="form-error">{pollError}</p>}
      <div className={styles.actions}>
        {order.canReuseCutout && <Link className="button button-primary" href={`/apps/recipes?recipe=studio-card&reuse=${order.id}`}>
          Собрать карточку с этим фото
        </Link>}
        <button type="button" className="button button-secondary" onClick={refresh} disabled={busy}>Обновить статус заказа</button>
      </div>
    </section>
    <aside className={styles.panel} aria-label="Оплата и оформление">
      <h2>{order.access === "trial" ? "Пробная обработка" : "Оплата заказа"}</h2>
      <strong className={styles.price}>{rub(order.priceKopecks)}</strong>
      {order.access === "premium" && <div>
        {payment && <p aria-live="polite">{paymentStatuses[payment.status]}</p>}
        {payment?.refundStatus && <p aria-live="polite">{refundStatuses[payment.refundStatus]}</p>}
        {order.status === "awaiting_payment" && payment === null && <p className={styles.hint}>
          {expired ? "Срок оплаты истёк. Создайте новый заказ." : canPay ? "Создайте тестовый платёж, чтобы запустить обработку." : "Тестовая оплата пока недоступна."}
        </p>}
        <div className={styles.actions}>
          {canPay && order.status === "awaiting_payment" && payment === null && !expired &&
            <button type="button" className="button button-primary" disabled={busy} onClick={() => updatePayment("payment")}>Создать тестовый платёж</button>}
          {payment?.status === "pending" && payment.mode === "mock" && <>
            <button type="button" className="button button-primary" disabled={busy} onClick={() => updatePayment("mock-payment", { outcome: "succeeded" })}>Подтвердить тестовую оплату</button>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => updatePayment("mock-payment", { outcome: "canceled" })}>Отменить платёж</button>
          </>}
          {payment?.status === "pending" && payment.confirmationUrl &&
            <a className="button button-primary" href={payment.confirmationUrl} rel="noreferrer">Открыть тестовую оплату ЮKassa</a>}
          {payment?.mode === "yookassa-test" && (payment.status === "pending" || payment.status === "unknown" || payment.refundStatus === "pending") &&
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => updatePayment("refresh-payment")}>Сверить платёж</button>}
          {order.status === "failed" && payment?.status === "succeeded" && !payment.refundStatus &&
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => updatePayment("refund")}>Запросить возврат</button>}
        </div>
      </div>}
      {canEdit && <div>
        <h2>Оформление макета</h2>
        <p className={styles.hint}>Обновите текст и цвет. Оформление пересобирается из уже подготовленного фото.</p>
        {editing ? <form onSubmit={updateLayout}>
          <fieldset disabled={busy} className={styles.fields}>
            <LayoutFields layout={editing.layout} onChange={layout => setEditing({ ...editing, layout })} />
            <div className={styles.actions}><button type="submit" className="button button-primary">Сохранить оформление</button>
              <button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Закрыть редактор</button></div>
          </fieldset>
        </form> : <button type="button" className="button button-secondary" disabled={busy}
          onClick={() => setEditing({ revision: order.revision, layout: order.layout })}>Изменить оформление</button>}
      </div>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </aside>
  </div>;
}
