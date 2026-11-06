import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI Content Maker — AI-инструменты на русском",
    template: "%s — AI Content Maker",
  },
  description: "Каталог AI-приложений для изображений, видео, рекламы и аудио. Демонстрационный прототип.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <div className="container header-inner">
              <Link href="/" className="brand" aria-label="AI Content Maker, главная">
                <span className="brand-symbol" aria-hidden="true">✳</span>
                <span>content<span className="brand-bold">maker</span><span className="brand-dot">.ai</span></span>
              </Link>
              <nav className="main-nav" aria-label="Основное меню">
                <Link href="/#catalog">Каталог</Link>
                <Link href="/#how">Как работает</Link>
              </nav>
              <span className="header-status">Проектирование · Демо</span>
            </div>
          </header>
          {children}
          <footer className="site-footer">
            <div className="container footer-inner">
              <span>© AI Content Maker · Прототип интерфейса</span>
              <span>Без реальных платежей и генераций</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
