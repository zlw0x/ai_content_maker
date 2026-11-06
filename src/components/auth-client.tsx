"use client";

import {FormEvent,useState} from "react";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {api,ApiError,safeNext} from "@/lib/api-client";

export function AuthClient(){
  const search=useSearchParams();
  const next=safeNext(search.get("next"));
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy)return;
    setError("");setBusy(true);
    try{
      await api<{user:{id:string;email:string}}>(register?"/auth/register":"/auth/login",{
        method:"POST",body:JSON.stringify({email,password})
      });
      window.location.assign(next);
    }catch(e){setError(e instanceof ApiError?e.message:"Не удалось подключиться к серверу");setBusy(false);}
  }
  return <div className="auth-card">
    <div className="eyebrow">Личный кабинет</div>
    <h1>{register?"Создать аккаунт":"С возвращением"}</h1>
    <p className="muted">{register?"Зарегистрируйся, чтобы создавать задания и хранить историю.":"Войди, чтобы продолжить работу с AI Apps."}</p>
    <form onSubmit={submit} className="auth-form">
      <label htmlFor="email">Email</label>
      <input id="email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} />
      <label htmlFor="password">Пароль</label>
      <input id="password" type="password" required minLength={12} maxLength={128}
        autoComplete={register?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} />
      <p className="small-note">Не менее 12 символов.</p>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary" disabled={busy} type="submit">{busy?"Проверяем…":register?"Зарегистрироваться":"Войти"}</button>
    </form>
    <button type="button" className="text-action" onClick={()=>{setRegister(!register);setError("");}}>
      {register?"Уже есть аккаунт? Войти":"Нет аккаунта? Зарегистрироваться"}
    </button>
    <p className="small-note">Это тестовая версия без подтверждения почты. Для публичного запуска потребуется дополнительная защита.</p>
    <Link href="/" className="muted">← Вернуться в каталог</Link>
  </div>;
}
