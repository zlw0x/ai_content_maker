import { recipeCatalog, recipeVersion, type RecipeLayout } from "./recipes";

const fixtures = [
  ["candle", "Свеча из соевого воска", "Аромат кедра", "490 ₽", "#9c4931"],
  ["thermos", "Термокружка", "Держит тепло до 6 часов", "1 290 ₽", "#346073"],
  ["headphones", "Беспроводные наушники", "Чистый звук каждый день", "3 490 ₽", "#53478a"],
  ["hand-cream", "Крем для рук", "Уход для сухой кожи", "590 ₽", "#a34364"],
] as const;

export const showcaseGroups = ["studio-card", "ad-banner", "remove-background"] as const;
export const recipeShowcase = showcaseGroups.flatMap(recipeKey => fixtures.map(([slug, title, benefit, price, color]) => ({
  id: `${slug}-${recipeKey}`, recipeKey, version: recipeVersion, title,
  beforeUrl: `/examples/product-card/${slug}.png`,
  afterUrl: `/examples/recipes/${slug}-${recipeKey}.webp`,
  layout: { title, benefit, price, color, alignment: "left" } satisfies RecipeLayout,
  summary: recipeCatalog[recipeKey].summary,
})));

export function getRecipeExample(id: string | undefined) {
  return recipeShowcase.find(example => example.id === id);
}
