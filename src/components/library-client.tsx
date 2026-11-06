"use client";

import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {api,ApiError,rub} from "@/lib/api-client";
import type {LibraryItem} from "@/server/library";

type Kind="all"|"image"|"video"|"audio";
type LibraryResponse={items:LibraryItem[];hasMore:boolean;nextPage:number|null};
const kinds:{id:Kind;label:string}[]=[
  {id:"all",label:"Все"},{id:"image",label:"Изображения"},
  {id:"video",label:"Видео"},{id:"audio",label:"Аудио"}
];
const statuses:Record<string,string>={
  reserved:"Резерв",queued:"В очереди",submitting:"Отправляем",
  processing:"Генерируется",unknown:"На сверке",completed:"Готово",failed:"Ошибка"
};
export function LibraryClient(){
  const [kind,setKind]=useState<Kind>("all");
  const [items,setItems]=useState<LibraryItem[]>([]);
  const [nextPage,setNextPage]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [loginNeeded,setLoginNeeded]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [confirmDelete,setConfirmDelete]=useState<string|null>(null);
  const load=useCallback(async(category:Kind,page=0)=>{
    setBusy(true);setError("");
    try{
      const data=await api<LibraryResponse>("/library?kind="+category+"&page="+page);
      setItems(prev=>page===0?data.items:[...prev,...data.items]);
      setNextPage(data.nextPage);
      setLoginNeeded(false);
    }catch(e){
      if(e instanceof ApiError&&e.status===401)setLoginNeeded(true);
      else setError(e instanceof Error?e.message:"Не удалось загрузить медиатеку");
    }finally{setBusy(false);}
  },[]);
  useEffect(()=>{void load(kind);},[kind,load]);
  const chosen=items.find(x=>x.id===selected)??null;
  async function remove(id:string){
    setBusy(true);setError("");
    try{
      await api("/library/"+id,{method:"DELETE"});
      setItems(prev=>prev.filter(x=>x.id!==id));
      setSelected(null);setConfirmDelete(null);
    }catch(e){setError(e instanceof Error?e.message:"Не удалось удалить работу");}
    finally{setBusy(false);}
  }
  if(loginNeeded)return <div className="empty-state"><h2>Войдите в аккаунт</h2>
    <p>Файлы и генерации доступны только их владельцу.</p>
    <Link className="button button-primary" href="/account?next=%2Flibrary">Войти</Link></div>;
  return <section className="media-library">
    <div className="dashboard-header">
      <div><span className="section-kicker">ЛИЧНЫЕ ФАЙЛЫ</span><h1>Моя медиатека</h1>
        <p className="muted">Ваши результаты хранятся на нашем сервере, без публичных ссылок WaveSpeed.</p></div>
      <Link className="button button-secondary" href="/dashboard">К балансу и заказам</Link>
    </div>
    <div className="library-filters" role="group" aria-label="Тип медиатеки">
      {kinds.map(x=><button type="button" key={x.id} aria-pressed={kind===x.id}
        className={"library-filter "+(kind===x.id?"active":"")} onClick={()=>{setKind(x.id);setSelected(null);}}>{x.label}</button>)}
      <button type="button" className="library-refresh" disabled={busy} onClick={()=>void load(kind)}>Обновить</button>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {!busy&&items.length===0?<div className="empty-state"><h3>Пока нет работ</h3>
      <p>Создайте генерацию — результат появится здесь после обработки.</p>
      <Link className="button button-primary" href="/#catalog">Открыть AI Apps</Link>
    </div>:<div className="library-grid">
      {items.map(item=><article className="library-card" key={item.id}>
        <button type="button" className="library-preview" onClick={()=>setSelected(item.id)} aria-label={"Открыть работу "+item.id.slice(0,8)}>
          {item.output?.mediaType.startsWith("image/")&&item.output.mediaType!=="image/svg+xml"?
            // Browser uses its own same-origin session cookie. The origin URL is never revealed.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.output.viewUrl} alt={item.prompt??"Результат генерации"} loading="lazy"/>:
            <div className="library-placeholder" aria-hidden="true">
              <span>{item.kind==="video"?"▶":item.kind==="audio"?"♫":item.status==="completed"?"✧":"…"} </span>
              <small>{item.status==="completed"?(item.kind==="video"?"Видео":item.kind==="audio"?"Аудио":"Файл"):"Задание"}</small>
            </div>}
        </button>
        <div className="library-card-body">
          <div className="library-card-top"><strong>{item.appSlug}</strong><span className={"job-status status-"+item.status}>{statuses[item.status]??item.status}</span></div>
          <p title={item.prompt??undefined}>{item.prompt??"Без текстового описания"}</p>
          <div className="library-card-bottom"><span>{new Date(item.createdAt).toLocaleDateString("ru-RU")}</span><span>{rub(item.priceKopecks)}</span></div>
        </div>
      </article>)}
    </div>}
    {busy&&items.length===0&&<p className="muted">Загружаем ваши работы…</p>}
    {nextPage!==null&&<div className="library-more"><button className="button button-secondary" type="button"
      disabled={busy} onClick={()=>void load(kind,nextPage)}>{busy?"Загружаем…":"Показать ещё"}</button></div>}
    {chosen&&<div className="library-backdrop" role="presentation" onClick={()=>setSelected(null)}>
      <div className="library-dialog" role="dialog" aria-modal="true" aria-label="Просмотр работы"
        onClick={e=>e.stopPropagation()}>
        <div className="library-dialog-header"><h2>{chosen.appSlug}</h2>
          <button type="button" aria-label="Закрыть" onClick={()=>{setSelected(null);setConfirmDelete(null);}}>✕</button></div>
        <div className="library-viewer">
          {chosen.output?.mediaType.startsWith("video/")?
            <video controls preload="metadata" src={chosen.output.viewUrl} />:
           chosen.output?.mediaType.startsWith("audio/")?
            <audio controls preload="metadata" src={chosen.output.viewUrl}/>:
           chosen.output?.mediaType.startsWith("image/")&&chosen.output.mediaType!=="image/svg+xml"?
            // eslint-disable-next-line @next/next/no-img-element
            <img src={chosen.output.viewUrl} alt={chosen.prompt??"Результат"}/>:
            <div className="library-placeholder">Предпросмотр недоступен; файл можно скачать</div>}
        </div>
        <p className="muted">{chosen.prompt??"Без описания"}</p>
        <div className="library-details"><span>{new Date(chosen.createdAt).toLocaleString("ru-RU")}</span>
          <span>{rub(chosen.priceKopecks)}</span>
          {chosen.output?.expiresAt&&<span>Файл доступен до {new Date(chosen.output.expiresAt).toLocaleDateString("ru-RU")}</span>}
        </div>
        <div className="library-actions">
          {chosen.output&&<a className="button button-primary" href={chosen.output.url}>Скачать оригинал</a>}
          <Link className="button button-secondary" href={"/apps/"+chosen.appSlug+"?repeat="+chosen.id}>Повторить с параметрами</Link>
          {["completed","failed"].includes(chosen.status)&&
            (confirmDelete===chosen.id?
              <button className="button button-danger" disabled={busy} type="button" onClick={()=>void remove(chosen.id)}>Подтвердить удаление</button>:
              <button className="button button-secondary" type="button" onClick={()=>setConfirmDelete(chosen.id)}>Удалить из медиатеки</button>)}
        </div>
        {confirmDelete===chosen.id&&<p className="small-note">Действие необратимо для файлов: результаты станут недоступны сразу, физическая очистка выполняется worker. Финансовые записи сохраняются.</p>}
      </div>
    </div>}
  </section>;
}
