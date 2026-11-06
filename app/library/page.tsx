import type {Metadata} from "next";
import {LibraryClient} from "@/components/library-client";
export const metadata:Metadata={title:"Моя медиатека"};
export default function LibraryPage(){return <main className="container dashboard-page"><LibraryClient/></main>;}
