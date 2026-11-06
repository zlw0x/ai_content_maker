import {Suspense} from "react";
import type {Metadata} from "next";
import {AuthClient} from "@/components/auth-client";
export const metadata:Metadata={title:"Вход и регистрация"};
export default function AccountPage(){
  return <main className="container auth-page">
    <Suspense fallback={<p>Загрузка…</p>}><AuthClient/></Suspense>
  </main>;
}
