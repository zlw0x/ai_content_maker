import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppDetails } from "@/components/app-details";
import { ProductCardMaker } from "@/components/product-card-maker";
import { RecipeExampleView } from "@/components/recipe-example-view";
import { getAppBySlug } from "@/lib/catalog";
import { getProductCardExample } from "@/lib/product-card-examples";
import { HttpError } from "@/server/errors";
import { currentUser } from "@/server/security";
import { recipeFunnelEnabled } from "@/server/recipe-funnel";

const app = getAppBySlug("product-card");

export const metadata: Metadata = { title: app?.title, description: app?.description };

export default async function ProductCardPage({
  searchParams,
}: {
  searchParams: Promise<{ example?: string | string[] }>;
}) {
  if (!app) notFound();
  const { example } = await searchParams;
  const exampleId = typeof example === "string" ? getProductCardExample(example)?.id : undefined;
  const funnelEnabled = recipeFunnelEnabled();
  const exampleView = exampleId && funnelEnabled ? <RecipeExampleView enabled /> : null;

  try {
    await currentUser();
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
    const next = exampleId ? "/apps/product-card?" + new URLSearchParams({ example: exampleId }) : "/apps/product-card";
    const loginUrl = "/account?" + new URLSearchParams({ next });
    return (
      <AppDetails app={app}>
        {exampleView}
        <div className="generation-panel">
          <div className="generation-heading"><h2>Бесплатная карточка товара</h2></div>
          <p className="muted">Войдите или создайте аккаунт, чтобы собрать и скачать карточку.</p>
          {exampleId && <p className="small-note">Выбранный пример откроется после входа.</p>}
          <Link className="button button-primary generate-button" href={loginUrl}>Войти или зарегистрироваться</Link>
        </div>
      </AppDetails>
    );
  }

  return <AppDetails app={app}>{exampleView}<ProductCardMaker key={exampleId} exampleId={exampleId} funnelEnabled={funnelEnabled} /></AppDetails>;
}
