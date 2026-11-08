import type { ReactNode } from "react";
import Link from "next/link";
import type { AiApp } from "@/lib/catalog";

export function AppDetails({ app, children }: { app: AiApp; children: ReactNode }) {
  const isProductCard = app.mode === "product-card";

  return (
    <main className="container detail-page">
      <nav className="breadcrumbs" aria-label="Навигационная цепочка">
        <Link href="/">Каталог</Link><span aria-hidden="true">/</span><span>{app.category}</span><span aria-hidden="true">/</span><strong>{app.title}</strong>
      </nav>
      <div className="detail-layout">
        <section className="detail-primary">
          <div className={"detail-visual " + app.visualClass} aria-hidden="true"><span>{app.symbol}</span></div>
          <div className="detail-titlebar"><span className="section-kicker">{app.category.toUpperCase()} · AI APP</span><span className="demo-chip">{isProductCard ? "Бесплатно" : "Демо"}</span></div>
          <h1>{app.title}</h1>
          <p className="detail-description">{app.description}</p>
          <div className="detail-examples">
            <h2>{isProductCard || app.mode === "scene" ? "Примеры" : "Примеры запросов"}</h2>
            {app.examples.map((example) => <div className="example-line" key={example}>✦ {example}</div>)}
          </div>
        </section>
        <aside className="detail-aside" aria-label={isProductCard ? "Настройки карточки" : "Настройки генерации"}>
          {children}
        </aside>
      </div>
    </main>
  );
}
