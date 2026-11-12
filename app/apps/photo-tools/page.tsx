import type { Metadata } from "next";
import Link from "next/link";
import { PhotoTools } from "@/components/photo-tools";
import { HttpError } from "@/server/errors";
import { currentUser } from "@/server/security";
import { recipeFunnelEnabled } from "@/server/recipe-funnel";

export const metadata: Metadata = {
  title: "Подготовка фото",
  description: "Измените размер, кадрируйте или сохраните фото в PNG, JPEG или WebP прямо в браузере.",
};

export default async function PhotoToolsPage() {
  let signedIn = false;
  try {
    await currentUser();
    signedIn = true;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
  }

  const loginUrl = "/account?" + new URLSearchParams({ next: "/apps/photo-tools" });
  return (
    <main className="container detail-page">
      <nav className="breadcrumbs" aria-label="Навигационная цепочка">
        <Link href="/">Каталог</Link><span aria-hidden="true">/</span><strong>Подготовка фото</strong>
      </nav>
      <div className="detail-layout">
        <section className="detail-primary">
          <div className="detail-visual tile-slate" aria-hidden="true"><span>↗</span></div>
          <div className="detail-titlebar"><span className="section-kicker">ИНСТРУМЕНТЫ</span><span className="demo-chip">Бесплатно</span></div>
          <h1>Подготовка фото</h1>
          <p className="detail-description">Измените размер, кадрируйте фото или сохраните его в PNG, JPEG или WebP.</p>
          <div className="detail-examples">
            <h2>Что можно сделать</h2>
            <div className="example-line">Уместить изображение в заданные размеры с сохранением пропорций.</div>
            <div className="example-line">Получить квадратный, вертикальный или горизонтальный кадр.</div>
            <div className="example-line">Сменить формат и сохранить исходные размеры до 4096 пикселей на сторону.</div>
          </div>
        </section>
        <aside className="detail-aside" aria-label="Настройки фото">
          {signedIn ? <PhotoTools funnelEnabled={recipeFunnelEnabled()} /> : <div className="generation-panel">
            <div className="generation-heading"><h2>Открыть инструмент</h2></div>
            <p className="muted">Войдите или создайте аккаунт, чтобы подготовить и скачать фото.</p>
            <Link className="button button-primary generate-button" href={loginUrl}>Войти или зарегистрироваться</Link>
          </div>}
        </aside>
      </div>
    </main>
  );
}
