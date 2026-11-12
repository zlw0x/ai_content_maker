import type { Metadata } from "next";
import Link from "next/link";
import { RecipeStudio } from "@/components/recipe-studio";
import { RecipeExampleView } from "@/components/recipe-example-view";
import styles from "@/components/recipe-studio.module.css";
import { isRecipeKey, recipeCatalog, type RecipeKey } from "@/lib/recipes";
import { getRecipeExample } from "@/lib/recipe-showcase";
import { HttpError } from "@/server/errors";
import { currentUser } from "@/server/security";
import { recipeFunnelEnabled } from "@/server/recipe-funnel";

export const metadata: Metadata = {
  title: "Студия рецептов",
  description: "Подготовьте карточку товара, рекламный комплект или фото с помощью готового AI-рецепта.",
};

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export default async function RecipesPage({ searchParams }: {
  searchParams: Promise<{ recipe?: string | string[]; order?: string | string[]; handoff?: string | string[]; reuse?: string | string[]; example?: string | string[] }>;
}) {
  const params = await searchParams;
  const orderId = typeof params.order === "string" && uuid.test(params.order) ? params.order : undefined;
  const handoff = !orderId && typeof params.handoff === "string" && uuid.test(params.handoff) ? params.handoff : undefined;
  const reuse = !orderId && !handoff && typeof params.reuse === "string" && uuid.test(params.reuse) ? params.reuse : undefined;
  const example = !orderId && !handoff && !reuse && typeof params.example === "string" ? getRecipeExample(params.example) : undefined;
  const funnelEnabled = recipeFunnelEnabled();
  const recipeKey = example?.recipeKey ?? (typeof params.recipe === "string" && isRecipeKey(params.recipe) ? params.recipe : "studio-card");
  const resume = "/apps/recipes?" + new URLSearchParams({ recipe: recipeKey, ...(orderId ? { order: orderId } : {}),
    ...(reuse ? { reuse } : {}), ...(example ? { example: example.id } : {}) });

  let signedIn = false;
  try {
    await currentUser();
    signedIn = true;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
  }

  return <main className={`container ${styles.page}`}>
    {example && funnelEnabled && <RecipeExampleView enabled />}
    <nav className="breadcrumbs" aria-label="Навигационная цепочка">
      <Link href="/">Каталог</Link><span aria-hidden="true">/</span><strong>Студия рецептов</strong>
    </nav>
    <header className={styles.hero}>
      <p className="section-kicker">Сделано AI · Студия</p>
      <h1>Готовые материалы из вашего фото</h1>
      <p>Карточки, реклама и обработка фотографий. Выберите результат, добавьте исходник и проверьте стоимость до запуска.</p>
    </header>
    {signedIn ? <RecipeStudio key={resume} initialRecipe={recipeKey} orderId={orderId} handoff={handoff} reuse={reuse} example={example} funnelEnabled={funnelEnabled} /> : <div className={styles.shell}>
      <section className={styles.panel} aria-labelledby="recipe-gallery-title">
        <h2 id="recipe-gallery-title">Что подготовим?</h2>
        <div className={styles.catalog}>
          {Object.entries(recipeCatalog).map(([key, recipe]) => <Link key={key}
            href={`/apps/recipes?recipe=${key as RecipeKey}`} aria-current={recipeKey === key ? "page" : undefined}
            className={styles.catalogItem}>
            <span className="section-kicker">{recipe.trial ? "AI Trial и Premium" : "Premium"}</span>
            <strong>{recipe.title}</strong><span>{recipe.summary}</span>
          </Link>)}
        </div>
      </section>
      <aside className={styles.panel} aria-label="Вход в студию">
        <h2>{orderId ? "Открыть заказ" : "Начать работу"}</h2>
        <p>{orderId ? "Войдите, чтобы открыть свой заказ и скачать готовые материалы." : `Вы выбрали «${recipeCatalog[recipeKey].title}». Продолжите работу в своём аккаунте.`}</p>
        <Link className="button button-primary" href={"/account?" + new URLSearchParams({ next: resume })}>
          Войти или зарегистрироваться
        </Link>
      </aside>
    </div>}
  </main>;
}
