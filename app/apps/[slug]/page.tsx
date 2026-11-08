import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppDemo } from "@/components/app-demo";
import { AppDetails } from "@/components/app-details";
import { apps, getAppBySlug } from "@/lib/catalog";

export async function generateStaticParams() {
  return apps.filter((app) => app.mode !== "product-card").map((app) => ({ slug: app.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const app = getAppBySlug(slug);
  return { title: app?.title ?? "Приложение", description: app?.description };
}

export default async function AppDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const app = getAppBySlug(slug);
  if (!app || app.mode === "product-card") notFound();
  return <AppDetails app={app}><AppDemo app={app} /></AppDetails>;
}
