"use client";

import {useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import type {AiApp} from "@/lib/catalog";
import {api,ApiError,rub} from "@/lib/api-client";

type Quote={id:string;amountKopecks:number;expiresInSeconds:number;currency:"RUB"};
type Order={id:string;status:string;priceKopecks:number};
export function AppDemo({app}:{app:AiApp}){
  const router=useRouter();
  const [prompt,setPrompt]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [size,setSize]=useState("1024*1024");
  const [resolution,setResolution]=useState("480p");
  const [duration,setDuration]=useState(5);
  const [orientation,setOrientation]=useState("landscape");
  const [voice,setVoice]=useState("Russian_ReliableMan");
  const [speed,setSpeed]=useState(1);
  const [strength,setStrength]=useState(0.6);
  const [quote,setQuote]=useState<Quote|null>(null);
  const [quotedUntil,setQuotedUntil]=useState(0);
  const [orderKey,setOrderKey]=useState("");
  const [busy,setBusy]=useState<"quote"|"order"|null>(null);
  const [error,setError]=useState("");
  const [isMock,setIsMock]=useState(true);
  const [loginNeeded,setLoginNeeded]=useState(false);
  const needsImage=app.mode==="image-prompt"||app.mode==="image-only";
  const needsPrompt=app.mode!=="image-only";
  const isVideo=app.category==="Видео";
  const isTextVideo=app.slug==="text-to-video";
  const isVoice=app.mode==="voice";
  const isImageText=app.slug==="text-to-image"||app.slug==="premium-image";
  useEffect(()=>{
    void api<{mock:boolean}>("/system").then(s=>setIsMock(s.mock)).catch(()=>{});
  },[]);
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get("repeat");
    if(!id||!/^[a-f0-9-]{36}$/i.test(id))return;
    void api<{repeatInput:Record<string,unknown>|null}>("/orders/"+id).then(item=>{
      const input=item.repeatInput;
      if(!input)return;
      setPrompt(String(input.prompt??input.text??""));
      if(typeof input.size==="string")setSize(input.size);
      if(input.duration===5||input.duration===8)setDuration(input.duration);
      if(input.resolution==="480p"||input.resolution==="720p")setResolution(input.resolution);
      if(input.orientation==="landscape"||input.orientation==="portrait")setOrientation(input.orientation);
      if(typeof input.voice==="string")setVoice(input.voice);
      if(typeof input.speed==="number")setSpeed(input.speed);
      if(typeof input.strength==="number")setStrength(input.strength);
      if(needsImage)setError("Параметры восстановлены. Загрузите исходное изображение повторно.");
    }).catch(()=>setError("Не удалось загрузить параметры предыдущей генерации"));
  },[app.slug,needsImage]);
  function change(update:()=>void){update();setQuote(null);setQuotedUntil(0);setOrderKey("");setError("");}
  function buildInput(assetId?:string):Record<string,unknown>{
    const input:Record<string,unknown>={};
    if(needsImage)input.imageAssetId=assetId;
    if(isVoice){input.text=prompt;input.voice=voice;input.speed=speed;}
    else if(needsPrompt)input.prompt=prompt;
    if(isImageText)input.size=size;
    if(isTextVideo){input.duration=duration;input.orientation=orientation;}
    if(app.slug==="photo-to-video"){input.resolution=resolution;input.duration=duration;}
    if(app.slug==="photo-editor")input.strength=strength;
    return input;
  }
  async function calculate(){
    if(busy)return;
    setBusy("quote");setError("");setQuote(null);setLoginNeeded(false);
    try{
      const user=await api<{id:string}>("/auth/me");
      if(!user.id)throw new Error("Не удалось подтвердить вход");
      let imageAssetId:string|undefined;
      if(needsImage){
        if(!file)throw new Error("Выберите фотографию");
        if(file.size===0||file.size>10*1024*1024)throw new Error("Файл должен быть до 10 MB");
        const form=new FormData();form.append("file",file);
        const uploaded=await api<{id:string}>("/assets",{method:"POST",body:form});
        imageAssetId=uploaded.id;
      }
      const q=await api<Quote>("/quotes",{method:"POST",body:JSON.stringify({appSlug:app.slug,input:buildInput(imageAssetId)})});
      setQuote(q);setQuotedUntil(Date.now()+q.expiresInSeconds*1000);
      setOrderKey(crypto.randomUUID());
    }catch(e){
      if(e instanceof ApiError&&e.status===401)setLoginNeeded(true);
      setError(e instanceof Error?e.message:"Ошибка расчёта");
    }finally{setBusy(null);}
  }
  async function confirmOrder(){
    if(!quote||!orderKey||busy)return;
    if(Date.now()>=quotedUntil){setQuote(null);setError("Стоимость устарела. Рассчитайте её заново.");return;}
    setBusy("order");setError("");
    try{
      const order=await api<Order>("/orders",{method:"POST",headers:{"Idempotency-Key":orderKey},body:JSON.stringify({quoteId:quote.id})});
      router.push("/dashboard?order="+encodeURIComponent(order.id));
    }catch(e){setError(e instanceof Error?e.message:"Ошибка создания заказа");}
    finally{setBusy(null);}
  }
  return <div className="generation-panel">
    <div className="generation-heading"><h2>Создать</h2><span className="demo-chip">{isMock?"Тестовый режим":"WaveSpeed API"}</span></div>
    {needsImage&&<div className="form-field">
      <label htmlFor="input-photo">Исходное изображение</label>
      <div className="upload-box">
        <span aria-hidden="true">↑</span>
        <span>{file?.name??"Выберите фотографию"}</span>
        <small>PNG, JPG, WebP · максимум 10 MB</small>
        <input id="input-photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>change(()=>setFile(e.target.files?.[0]??null))}/>
      </div>
    </div>}
    {needsPrompt&&<div className="form-field">
      <label htmlFor="prompt">{isVoice?"Текст озвучки":"Опиши желаемый результат"}</label>
      <textarea id="prompt" value={prompt} maxLength={isVoice?5000:2000} rows={5} placeholder={app.examples[0]}
        onChange={e=>change(()=>setPrompt(e.target.value))} />
      <span className="field-help">{prompt.length} / {isVoice?5000:2000} символов</span>
    </div>}
    {isImageText&&<div className="form-field"><label htmlFor="image-size">Размер изображения</label>
      <select id="image-size" value={size} onChange={e=>change(()=>setSize(e.target.value))}>
        <option value="1024*1024">Квадратное</option><option value="1536*1024">Горизонтальное</option><option value="1024*1536">Вертикальное</option>
      </select>
    </div>}
    {app.slug==="photo-editor"&&<div className="form-field"><label htmlFor="strength">Сила изменения: {strength.toFixed(1)}</label>
      <input id="strength" type="range" min="0.1" max="0.9" step="0.1" value={strength} onChange={e=>change(()=>setStrength(Number(e.target.value)))}/>
    </div>}
    {isVideo&&<div className="form-columns">
      {isTextVideo?<div className="form-field"><label htmlFor="orientation">Формат</label><select id="orientation" value={orientation} onChange={e=>change(()=>setOrientation(e.target.value))}>
        <option value="landscape">Горизонтальный</option><option value="portrait">Вертикальный</option></select></div>:
      <div className="form-field"><label htmlFor="resolution">Качество</label><select id="resolution" value={resolution} onChange={e=>change(()=>setResolution(e.target.value))}>
        <option value="480p">480p</option><option value="720p">720p</option></select></div>}
      <div className="form-field"><label htmlFor="duration">Длительность</label><select id="duration" value={duration} onChange={e=>change(()=>setDuration(Number(e.target.value)))}>
        <option value={5}>5 секунд</option><option value={8}>8 секунд</option></select></div>
    </div>}
    {isVoice&&<div className="form-columns">
      <div className="form-field"><label htmlFor="voice">Голос</label><select id="voice" value={voice} onChange={e=>change(()=>setVoice(e.target.value))}>
        <option value="Russian_ReliableMan">Мужской, спокойный</option>
        <option value="Russian_AttractiveGuy">Мужской, глубокий</option>
        <option value="Russian_BrightHeroine">Женский, яркий</option>
        <option value="Russian_AmbitiousWoman">Женский, уверенный</option>
      </select></div>
      <div className="form-field"><label htmlFor="speed">Скорость</label><select id="speed" value={speed} onChange={e=>change(()=>setSpeed(Number(e.target.value)))}>
        <option value={0.8}>Медленно</option><option value={1}>Обычная</option><option value={1.2}>Быстро</option></select></div>
    </div>}
    <div className="price-summary">
      <div><strong>{quote?rub(quote.amountKopecks):"По расчёту"}</strong><span>{quote?"Итоговая цена":"Цена уточняется у сервера"}</span></div>
      <small>{quote?"Котировка действительна 10 минут. Итоговая сумма будет зарезервирована после подтверждения.":"Сначала получим точную стоимость и покажем её до создания заказа."}</small>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {loginNeeded&&<Link className="button button-secondary full-width" href={"/account?next="+encodeURIComponent("/apps/"+app.slug)}>Войти или зарегистрироваться</Link>}
    {quote?<button className="button button-primary generate-button" type="button" disabled={busy!==null} onClick={()=>void confirmOrder()}>
      {busy==="order"?"Подтверждаем…":"Запустить за "+rub(quote.amountKopecks)}
    </button>:<button className="button button-primary generate-button" type="button" disabled={busy!==null} onClick={()=>void calculate()}>
      {busy==="quote"?"Загружаем и рассчитываем…":"Рассчитать стоимость"}
    </button>}
    <p className="disabled-note">{isMock?
      "Mock: без расходов провайдера, результат — демонстрационный файл.":
      "WaveSpeed live: запуск может потратить реальный баланс API-аккаунта. Точная цена подтверждается перед заказом."}</p>
  </div>;
}
