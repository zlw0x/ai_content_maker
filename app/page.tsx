import Image from "next/image";
import Link from "next/link";
import { CatalogExplorer } from "@/components/catalog-explorer";
import { apps } from "@/lib/catalog";
import { productCardExamples } from "@/lib/product-card-examples";
import styles from "./sdelano-home.module.css";

const steps = [
  { title: "Загрузите фото", description: "Выберите JPG, PNG или WebP с изображением товара." },
  { title: "Выберите оформление", description: "Добавьте название и, при желании, одно преимущество товара." },
  { title: "Скачайте карточку", description: "Получите готовый PNG 1200 × 1600 для дальнейшей публикации." },
];

export default function HomePage() {
  const [featuredExample] = productCardExamples;

  return (
    <main className={styles.home}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={`container ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}><span /> МАСТЕРСКАЯ КОНТЕНТА</p>
            <h1 id="home-title">Карточка товара <em>из вашего фото</em></h1>
            <p className={styles.lead}>
              Добавьте название, выберите оформление и скачайте готовый макет. Подходит для каталога,
              витрины магазина или соцсетей.
            </p>
            <div className={styles.actions}>
              <Link href="/apps/product-card" className={styles.primary}>Собрать карточку <span aria-hidden="true">↗</span></Link>
              <Link href="#showcase" className={styles.secondary}>Смотреть примеры <span aria-hidden="true">↓</span></Link>
            </div>
            <p className={styles.heroNote}>Бесплатно после входа <span aria-hidden="true">·</span> Фото остаётся в браузере</p>
          </div>

          <figure className={styles.heroExample}>
            <figcaption><span>ПРИМЕР ОФОРМЛЕНИЯ</span><span>01 / {String(productCardExamples.length).padStart(2, "0")}</span></figcaption>
            <div className={styles.heroPair}>
              <div className={styles.heroBefore}>
                <Image src={featuredExample.beforeUrl} alt={`Иллюстрация товара: ${featuredExample.title}`} width={960} height={960} sizes="(max-width: 760px) 40vw, 240px" preload />
                <span>Исходник</span>
              </div>
              <span className={styles.heroArrow} aria-hidden="true">→</span>
              <div className={styles.heroAfter}>
                <Image src={featuredExample.afterUrl} alt={`Готовая карточка: ${featuredExample.title}`} width={1200} height={1600} sizes="(max-width: 760px) 45vw, 270px" preload />
                <span>Готовый макет</span>
              </div>
            </div>
            <div className={styles.heroExampleFoot}><span>{featuredExample.styleLabel}</span><span>PNG · 1200 × 1600</span></div>
          </figure>
        </div>
      </section>

      <section className={`container ${styles.tiers}`} aria-label="Доступ к инструментам">
        <article className={styles.tier}>
          <span className={`${styles.tierLabel} ${styles.tierFree}`}>FREE · ДОСТУПНО</span>
          <h2>Бесплатные инструменты</h2>
          <p>Соберите карточку, обрежьте фото или смените его формат. Обработка идёт в браузере.</p>
          <Link href="/apps/photo-tools">Подготовить фото <span aria-hidden="true">↗</span></Link>
        </article>
        <article className={styles.tier}>
          <span className={styles.tierLabel}>AI TRIAL</span>
          <h2>Первая AI-операция</h2>
          <p>Один пробный запуск для аккаунта с подтверждённой почтой.</p>
          <Link href="/apps/recipes?recipe=remove-background">Открыть обработку фото <span aria-hidden="true">↗</span></Link>
        </article>
        <article className={styles.tier}>
          <span className={styles.tierLabel}>PREMIUM</span>
          <h2>Рекламные комплекты</h2>
          <p>Многошаговые сценарии и профессиональные шаблоны для кампаний.</p>
          <Link href="/apps/recipes">Открыть студию рецептов <span aria-hidden="true">↗</span></Link>
          <Link href="/examples">Посмотреть примеры AI-рецептов <span aria-hidden="true">↗</span></Link>
        </article>
      </section>

      <section className={`container ${styles.section}`} id="showcase" aria-labelledby="showcase-title">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.kicker}><span /> ДО И ПОСЛЕ</p>
            <h2 id="showcase-title">Витрина</h2>
            <p>Карточки собраны в редакторе из демонстрационных иллюстраций. Откройте любой пример, чтобы повторить его или подставить свой товар.</p>
          </div>
          <span className={styles.counter}>{productCardExamples.length} примеров</span>
        </div>
        <div className={styles.showcaseGrid}>
          {productCardExamples.map((example) => (
            <article key={example.id} className={styles.example}>
              <div className={styles.examplePair}>
                <div>
                  <Image src={example.beforeUrl} alt={`Исходник: ${example.title}`} width={960} height={960} sizes="(max-width: 560px) 44vw, (max-width: 920px) 22vw, 180px" />
                  <span>До</span>
                </div>
                <div>
                  <Image src={example.afterUrl} alt={`Карточка: ${example.title}, ${example.styleLabel}`} width={1200} height={1600} sizes="(max-width: 560px) 44vw, (max-width: 920px) 22vw, 180px" />
                  <span>После</span>
                </div>
              </div>
              <div className={styles.exampleFoot}>
                <div>
                  <h3>{example.title}</h3>
                  <p>{example.styleLabel}</p>
                </div>
                <Link href={`/apps/product-card?example=${encodeURIComponent(example.id)}`} className={styles.exampleLink}>
                  Создать так же<span className="sr-only">{` — ${example.title}, ${example.styleLabel}`}</span><span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`container ${styles.section} ${styles.catalog}`} id="catalog" aria-labelledby="catalog-title">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.kicker}><span /> ИНСТРУМЕНТЫ</p>
            <h2 id="catalog-title">Каталог</h2>
            <p>Бесплатный редактор карточек и AI-демо для изображений, видео и озвучки.</p>
          </div>
          <span className={styles.counter}>{apps.length} инструментов</span>
        </div>
        <CatalogExplorer />
      </section>

      <section className={styles.how} id="how" aria-labelledby="how-title">
        <div className="container">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.kicker}><span /> ПЕРВАЯ КАРТОЧКА</p>
              <h2 id="how-title">Три шага до макета</h2>
            </div>
            <Link href="/apps/product-card" className={styles.secondary}>Открыть редактор <span aria-hidden="true">↗</span></Link>
          </div>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
