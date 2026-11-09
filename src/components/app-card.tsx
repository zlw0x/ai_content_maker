import Link from "next/link";
import type { AiApp } from "@/lib/catalog";

export function AppCard({ app }: { app: AiApp }) {
  const isFree = app.mode === "product-card";
  return (
    <Link href={"/apps/" + app.slug} className="app-card" data-mode={app.mode}>
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
          <span>{isFree ? "Бесплатно после входа" : "Цена по расчёту"}</span>
          <span className={isFree ? "demo-chip app-access-free" : "demo-chip"}>{isFree ? "Free" : "AI-демо"}</span>
        </div>
      </div>
    </Link>
  );
}
