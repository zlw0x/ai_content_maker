import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Сделано AI — карточки товара и контент для магазина",
    template: "%s — Сделано AI",
  },
  description: "Соберите карточку товара из своего фото. Готовые оформления, примеры до и после и экспорт PNG.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <div className="container header-inner">
              <Link href="/" className="brand" aria-label="Сделано AI, главная">
                <span className="brand-symbol" aria-hidden="true">✳</span>
                <span className="brand-bold">Сделано <span className="brand-dot">AI</span></span>
              </Link>
              <nav className="main-nav" aria-label="Основное меню">
                <Link href="/#catalog">Каталог</Link>
                <Link href="/#showcase">Витрина</Link>
                <Link href="/dashboard">Мои генерации</Link>
                <Link href="/library">Медиатека</Link>
                <Link href="/account">Вход</Link>
              </nav>
              <span className="header-status">MVP · Тестирование</span>
            </div>
          </header>
          {children}
          <footer className="site-footer">
            <div className="container footer-inner">
              <span>© Сделано AI</span>
              <span>Mock-режим по умолчанию · Без реальных платежей</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
