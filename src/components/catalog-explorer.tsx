"use client";

import { useMemo, useState } from "react";
import { AppCard } from "@/components/app-card";
import { apps, categories } from "@/lib/catalog";

export function CatalogExplorer() {
  const [category, setCategory] = useState<string>("Все");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru");
    return apps.filter((app) => {
      const matchesCategory = category === "Все" || app.category === category;
      const matchesQuery = !q || [app.title, app.subtitle, app.description, app.category]
        .join(" ").toLocaleLowerCase("ru").includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  return (
    <>
      <div className="catalog-tools">
        <div className="category-tabs" role="group" aria-label="Категории приложений">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={"category-tab" + (item === category ? " active" : "")}
              aria-pressed={item === category}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Поиск приложений</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти инструмент..."
          />
        </label>
      </div>
      <p className="result-count">Найдено: {filtered.length} из {apps.length}</p>
      {filtered.length ? (
        <div className="apps-grid">
          {filtered.map((app) => <AppCard key={app.slug} app={app} />)}
        </div>
      ) : (
        <div className="empty-state">
          <h3>Ничего не найдено</h3>
          <p>Попробуйте другое название или откройте все категории.</p>
          <button type="button" className="button button-secondary" onClick={() => {setQuery(""); setCategory("Все");}}>Сбросить фильтры</button>
        </div>
      )}
    </>
  );
}
