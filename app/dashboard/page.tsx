import type {Metadata} from "next";
import {DashboardClient} from "@/components/dashboard-client";
export const metadata:Metadata={title:"Мои генерации"};
export default function DashboardPage(){
  return <main className="container dashboard-page"><DashboardClient/></main>;
}
