import type {Metadata} from "next";
import {LibraryClient} from "@/components/library-client";
import Link from "next/link";
import {recipeCatalog} from "@/lib/recipes";
import {HttpError} from "@/server/errors";
import {listRecipeOrders} from "@/server/recipe-orders";
import {currentUser} from "@/server/security";

export const metadata:Metadata={title:"Моя медиатека"};

async function RecipeHistory() {
  let user;
  try { user = await currentUser(); }
  catch (error) {
    if (error instanceof HttpError && error.status === 401) return null;
    throw error;
  }
  const orders = await listRecipeOrders(user.id);
  if (!orders.length) return null;
  return <section className="generation-panel" aria-labelledby="recipe-history-title">
    <div className="generation-heading"><h2 id="recipe-history-title">Заказы студии</h2></div>
    <ul>{orders.map(order => <li key={order.id}>
      <Link href={`/apps/recipes?order=${order.id}&recipe=${order.recipeKey}`}>
        {recipeCatalog[order.recipeKey]?.title ?? "Рецепт"}{order.layout.title ? ` — ${order.layout.title}` : ""}
      </Link>
    </li>)}</ul>
  </section>;
}

export default function LibraryPage(){return <main className="container dashboard-page"><LibraryClient/><RecipeHistory/></main>;}
