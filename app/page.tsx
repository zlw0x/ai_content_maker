import Link from "next/link";
import { CatalogExplorer } from "@/components/catalog-explorer";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> Одна платформа для AI-контента</div>
            <h1>Создавай больше.<br /><span className="gradient-text">Без сложных настроек.</span></h1>
            <p className="hero-lead">
              Изображения, видео, реклама, озвучка и инструменты для творчества
              — в одном русскоязычном каталоге.
            </p>
            <div className="hero-actions">
              <Link href="/#catalog" className="button button-primary">Смотреть приложения <span aria-hidden="true">↗</span></Link>
              <span className="hero-caption">Можно тестировать весь сценарий через сайт</span>
            </div>
            <div className="hero-points">
              <span>✳ Готовые сценарии</span>
              <span>◎ Понятные параметры</span>
              <span>◈ Оплата в ₽ — в планах</span>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
            <div className="visual-glow" />
            <div className="visual-panel panel-main">
              <div className="panel-topline"><span>✦ AI Studio</span><span className="panel-dot" /></div>
              <div className="panel-abstract">
                <div className="abstract-sphere" />
                <div className="abstract-ring" />
              </div>
              <div className="panel-bottom"><span>Твоя идея → результат</span><span>01 / 10</span></div>
            </div>
            <div className="visual-panel panel-float panel-float-one"><span>✺</span> Редактор фото</div>
            <div className="visual-panel panel-float panel-float-two"><span>▶</span> AI Видео</div>
          </div>
        </div>
      </section>

      <section className="catalog-section container" id="catalog" aria-labelledby="catalog-title">
        <div className="section-heading">
          <div>
            <span className="section-kicker">ИНСТРУМЕНТЫ ДЛЯ ИДЕЙ</span>
            <h2 id="catalog-title">Каталог AI Apps</h2>
            <p>Выбери задачу — мы предложим простой интерфейс без сложных технических параметров.</p>
          </div>
          <span className="catalog-pill">10 AI Apps · MVP</span>
        </div>
        <CatalogExplorer />
      </section>

      <section id="how" className="how-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">ПРОСТОЙ ПРОЦЕСС</span>
              <h2>От идеи до результата</h2>
            </div>
          </div>
          <div className="steps-grid">
            <article className="step-card"><span className="step-number">01</span><h3>Выбери приложение</h3><p>Фото, видео, реклама, голос — готовые сценарии для конкретных задач.</p></article>
            <article className="step-card"><span className="step-number">02</span><h3>Настрой генерацию</h3><p>Достаточно описания и, где нужно, исходного изображения.</p></article>
            <article className="step-card"><span className="step-number">03</span><h3>Получи готовый файл</h3><p>На следующих этапах добавим генерацию, оплату через СБП и историю заказов.</p></article>
          </div>
        </div>
      </section>
      <div className="container"><div className="demo-notice">В стартовой конфигурации задачи обрабатываются тестовым адаптером: он возвращает демонстрационные файлы. Реальная генерация через WaveSpeed включается администратором после отдельной проверки.</div></div>
    </main>
  );
}
