type RecipeHandoff = { file: File; title: string; benefit: string; price: string; frame?: true };

const ttl = 5 * 60 * 1000;
let pending: { token: string; expiresAt: number; data: RecipeHandoff } | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

export function startRecipeHandoff(data: RecipeHandoff) {
  clearTimeout(expiryTimer);
  const token = crypto.randomUUID();
  pending = { token, data, expiresAt: Date.now() + ttl };
  expiryTimer = setTimeout(() => { pending = undefined; }, ttl);
  return token;
}

export function takeRecipeHandoff(token: string) {
  if (pending?.token !== token) return;
  const current = pending;
  pending = undefined;
  clearTimeout(expiryTimer);
  if (current.expiresAt > Date.now()) return current.data;
}
