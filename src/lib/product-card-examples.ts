export const productCardStyles = [
  { id: "minimal", label: "Минимализм", paper: "#f2eee8", photo: "#fff", ink: "#211e1a", accent: "#5e4b40" },
  { id: "bright", label: "Яркий акцент", paper: "#f8dc54", photo: "#fff3b4", ink: "#261f37", accent: "#64368d" },
  { id: "dark", label: "Тёмная витрина", paper: "#1b2330", photo: "#293648", ink: "#f8f5ee", accent: "#8ae2ca" },
] as const;

const products = [
  { id: "thermos", title: "Термокружка", benefit: "Объём 450 мл" },
  { id: "candle", title: "Свеча в стакане", benefit: "С ароматом кедра" },
  { id: "headphones", title: "Наушники", benefit: "Мягкие амбушюры" },
  { id: "hand-cream", title: "Крем для рук", benefit: "Удобный тюбик 50 мл" },
] as const;

export const productCardExamples = products.flatMap(product => productCardStyles.map((style, styleIndex) => {
  const id = `${product.id}-${style.id}`;
  return {
    id,
    title: product.title,
    benefit: product.benefit,
    styleIndex,
    styleLabel: style.label,
    beforeUrl: `/examples/product-card/${product.id}.png`,
    afterUrl: `/examples/product-card/${id}.webp`,
  };
}));

export function getProductCardExample(id?: string) {
  return productCardExamples.find(example => example.id === id);
}
