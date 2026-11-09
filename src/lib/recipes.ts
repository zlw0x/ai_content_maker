export const recipeVersion = 1;

export const recipeCatalog = {
  "studio-card": { title: "Студийная карточка", summary: "Три оформления карточки с одним и тем же товаром.", priceKopecks: 2900, operation: "cutout", trial: false },
  "ad-banner": { title: "Премиальная реклама", summary: "Квадратный пост, история и широкая обложка.", priceKopecks: 5900, operation: "cutout", trial: false },
  "ad-kit": { title: "Рекламный комплект", summary: "Карточка, пост, история и обложка в одном стиле.", priceKopecks: 9900, operation: "cutout", trial: false },
  "remove-background": { title: "Удалить фон", summary: "Товар на прозрачном фоне в PNG.", priceKopecks: 2900, operation: "cutout", trial: true },
  "enhance-photo": { title: "Улучшить фото", summary: "Увеличение разрешения и детализации в PNG.", priceKopecks: 3900, operation: "upscale", trial: true },
} as const;

export type RecipeKey = keyof typeof recipeCatalog;
export type RecipeLayout = { title: string; benefit: string; price: string; color: string; alignment: "left" | "center" | "right" };

export function isRecipeKey(key: string): key is RecipeKey {
  return Object.hasOwn(recipeCatalog, key);
}
