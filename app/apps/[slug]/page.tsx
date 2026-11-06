import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppDemo } from "@/components/app-demo";
import { apps, getAppBySlug } from "@/lib/catalog";

export async function generateStaticParams() {
  return apps.map((app) => ({ slug: app.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const app = getAppBySlug(slug);
  return { title: app?.title ?? "Приложение", description: app?.description };
}

export default async function AppDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const app = getAppBySlug(slug);
  if (!app) notFound();

  return (
    <main className="container detail-page">
      <nav className="breadcrumbs" aria-label="Навигационная цепочка">
        <Link href="/">Каталог</Link><span aria-hidden="true">/</span><span>{app.category}</span><span aria-hidden="true">/</span><strong>{app.title}</strong>
      </nav>
      <div className="detail-layout">
        <section className="detail-primary">
          <div className={"detail-visual " + app.visualClass} aria-hidden="true"><span>{app.symbol}</span></div>
          <div className="detail-titlebar"><span className="section-kicker">{app.category.toUpperCase()} · AI APP</span><span className="demo-chip">Демо</span></div>
          <h1>{app.title}</h1>
          <p className="detail-description">{app.description}</p>
          <div className="detail-examples">
            <h2>Примеры запросов</h2>
            {app.examples.map((example) => <div className="example-line" key={example}>✦ {example}</div>)}
          </div>
        </section>
        <aside className="detail-aside" aria-label="Настройки генерации">
          <AppDemo app={app} />
        </aside>
      </div>
    </main>
  );
}
