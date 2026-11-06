import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container notfound">
      <div className="eyebrow">404 · Страница не найдена</div>
      <h1>Такого приложения пока нет</h1>
      <p>Вернись в каталог и выбери один из доступных концептов.</p>
      <Link className="button button-primary" href="/">Вернуться в каталог</Link>
    </main>
  );
}
