import Link from "next/link";
import type { AiApp } from "@/lib/catalog";

export function AppCard({ app }: { app: AiApp }) {
  return (
    <Link href={"/apps/" + app.slug} className="app-card">
      <div className={"app-visual " + app.visualClass} aria-hidden="true">
        <span className="app-visual-aura" />
        <span className="app-symbol">{app.symbol}</span>
        {app.featured && <span className="featured-tag">Популярный сценарий</span>}
      </div>
      <div className="app-card-body">
        <div className="card-meta"><span>{app.category}</span><span className="card-arrow">↗</span></div>
        <h3>{app.title}</h3>
        <p>{app.subtitle}</p>
        <div className="app-card-bottom">
          <span>{app.mode === "product-card" ? "Бесплатно" : app.demoStartingPrice === null ? "Цена уточняется" : "Планируем от " + app.demoStartingPrice + " ₽"}</span>
          <span className="demo-chip">{app.mode === "product-card" ? "В браузере" : "Демо"}</span>
        </div>
      </div>
    </Link>
  );
}
