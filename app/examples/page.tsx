import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { recipeShowcase, showcaseGroups } from "@/lib/recipe-showcase";
import { recipeCatalog } from "@/lib/recipes";
import styles from "../sdelano-home.module.css";

export const metadata: Metadata = { title: "Примеры AI-рецептов" };

export default function ExamplesPage() {
  return <main className={`${styles.home} container detail-page`}>
    <nav className="breadcrumbs" aria-label="Навигационная цепочка"><Link href="/">Главная</Link><span aria-hidden="true">/</span><strong>Примеры AI-рецептов</strong></nav>
    <h1>До и после · примеры AI-рецептов</h1>
    <p>В примерах использованы демонстрационные фото и реальные результаты удаления фона. Карточки и реклама собраны из того же товара в студии.</p>
    {showcaseGroups.map(key => <section className={styles.section} aria-labelledby={`examples-${key}`} key={key}>
      <div className={styles.sectionHead}><div><h2 id={`examples-${key}`}>{recipeCatalog[key].title}</h2><p>{recipeCatalog[key].summary}</p></div></div>
      <div className={styles.showcaseGrid}>
        {recipeShowcase.filter(example => example.recipeKey === key).map(example => <article className={styles.example} key={example.id}>
          <div className={styles.examplePair}>
            <div><Image src={example.beforeUrl} alt={`${example.title}, исходник`} width={960} height={960} sizes="(max-width: 560px) 44vw, 180px" /><span>До</span></div>
            <div><Image src={example.afterUrl} alt={`${example.title}, результат`} width={key === "studio-card" ? 540 : 560} height={key === "studio-card" ? 720 : 560} sizes="(max-width: 560px) 44vw, 180px" /><span>После</span></div>
          </div>
          <div className={styles.exampleFoot}><h3>{example.title}</h3><Link className={styles.exampleLink} href={`/apps/recipes?recipe=${key}&example=${example.id}`}>Создать так же<span className="sr-only"> — {example.title}</span></Link></div>
        </article>)}
      </div>
    </section>)}
  </main>;
}
