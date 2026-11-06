"use client";

import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {api,ApiError,rub,AppJob,JobDetail} from "@/lib/api-client";

type User={id:string;email:string};
type Wallet={availableKopecks:number;reservedKopecks:number};
type SystemInfo={mock:boolean;demoCreditEnabled:boolean;paymentsEnabled:boolean};
const labels:Record<string,string>={
  reserved:"Средства зарезервированы",queued:"В очереди",submitting:"Отправляем",
  processing:"Генерируется",unknown:"Требуется сверка",completed:"Готово",failed:"Ошибка"
};
function statusTitle(status:string){return labels[status]??status;}
export function DashboardClient(){
  const [user,setUser]=useState<User|null>(null);
  const [wallet,setWallet]=useState<Wallet|null>(null);
  const [jobs,setJobs]=useState<AppJob[]>([]);
  const [details,setDetails]=useState<Record<string,JobDetail>>({});
  const [system,setSystem]=useState<SystemInfo|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [needsLogin,setNeedsLogin]=useState(false);
  const load=useCallback(async()=>{
    try{
      const [u,w,j,s]=await Promise.all([
        api<User>("/auth/me"),api<Wallet>("/wallet"),api<{items:AppJob[]}>("/orders"),api<SystemInfo>("/system")
      ]);
      setUser(u);setWallet(w);setJobs(j.items);setSystem(s);setNeedsLogin(false);
    }catch(e){
      if(e instanceof ApiError&&e.status===401)setNeedsLogin(true);
      else setError(e instanceof Error?e.message:"Не удалось получить данные");
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),5000);return()=>clearInterval(timer);},[load]);
  async function addDemoFunds(){
    setBusy(true);setError("");
    try{await api("/demo/credit",{method:"POST",body:"{}"});await load();}
    catch(e){setError(e instanceof Error?e.message:"Ошибка тестового пополнения");}
    finally{setBusy(false);}
  }
  async function logout(){
    setBusy(true);
    try{await api("/auth/logout",{method:"POST",body:"{}"});window.location.assign("/account");}
    catch(e){setError(e instanceof Error?e.message:"Ошибка выхода");setBusy(false);}
  }
  async function viewOutput(id:string){
    try{
      const detail=await api<JobDetail>("/orders/"+id);
      setDetails(old=>({...old,[id]:detail}));
    }catch(e){setError(e instanceof Error?e.message:"Не удалось получить файл");}
  }
  if(loading)return <div className="dashboard-info">Загрузка кабинета…</div>;
  if(needsLogin)return <div className="dashboard-info"><h1>Требуется вход</h1><Link className="button button-primary" href="/account?next=%2Fdashboard">Войти или зарегистрироваться</Link></div>;
  return <div className="dashboard">
    <div className="dashboard-header">
      <div><span className="section-kicker">ЛИЧНОЕ ПРОСТРАНСТВО</span><h1>Мои генерации</h1><p className="muted">{user?.email}</p></div>
      <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void logout()}>Выйти</button>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="wallet-grid">
      <div className="wallet-card"><span>Доступно</span><strong>{wallet?rub(wallet.availableKopecks):"—"}</strong></div>
      <div className="wallet-card"><span>Зарезервировано</span><strong>{wallet?rub(wallet.reservedKopecks):"—"}</strong></div>
      <div className="wallet-card wallet-actions">
        {system?.mock&&system.demoCreditEnabled?<>
          <strong>Тестовый режим</strong>
          <p>Один раз можно получить 500 ₽ для проверки генераций.</p>
          <button className="button button-primary" disabled={busy} onClick={()=>void addDemoFunds()}>{busy?"Обрабатываем…":"Получить тестовые 500 ₽"}</button>
        </>:<>
          <strong>{system?.paymentsEnabled?"Пополнение":"Оплата отключена"}</strong>
          <p>Платежи в интерфейсе пока не принимаются. Режимы API настраивает администратор.</p>
        </>}
      </div>
    </div>
    <div className="dashboard-section-heading"><h2>История заданий</h2><Link className="button button-secondary" href="/#catalog">Новая генерация</Link></div>
    {jobs.length===0?<div className="empty-state"><h3>Пока нет генераций</h3><p>Открой каталог и создай первое задание.</p></div>:
    <div className="jobs-list">
      {jobs.map(job=><article key={job.id} className="job-card">
        <div className="job-header"><div><strong>{job.appSlug}</strong><p>{new Date(job.createdAt).toLocaleString("ru-RU")}</p></div><span className={"job-status status-"+job.status}>{statusTitle(job.status)}</span></div>
        <div className="job-meta"><span>{rub(job.priceKopecks)}</span><span>#{job.id.slice(0,8)}</span></div>
        {job.status==="unknown"&&<p className="small-note">Неизвестен итог отправки задания провайдеру. Средства остаются зарезервированы до сверки. Не создавай повторный заказ.</p>}
        {job.status==="failed"&&<p className="form-error">Задание завершилось ошибкой: {job.errorCode??"Ошибка провайдера"}</p>}
        {job.status==="completed"&&<>
          {!details[job.id]&&<button className="button button-secondary" type="button" onClick={()=>void viewOutput(job.id)}>Показать результат</button>}
          {details[job.id]&&<div className="output-list">
            {details[job.id].outputs.map(file=><a key={file.id} className="button button-primary" href={file.url}>Скачать {file.mediaType.split("/")[0]}</a>)}
            {details[job.id].outputs.length===0&&<p className="small-note">Файл не найден или срок хранения истёк.</p>}
          </div>}
        </>}
      </article>)}
    </div>}
    <p className="small-note">Статусы обновляются примерно раз в 5 секунд. В тестовом режиме результат — демонстрационный файл, не генерация нейросети.</p>
  </div>;
}
