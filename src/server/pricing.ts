import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { config } from "./config";
import { HttpError } from "./errors";

export function quoteKopecks(costUsd: string): number {
  const c=config();
  let cost: Decimal;
  try { cost=new Decimal(costUsd); } catch { throw new HttpError(503,"PRICE_INVALID","Некорректная цена провайдера"); }
  if(!cost.isFinite() || cost.isNegative() || cost.greaterThan(c.MAX_PROVIDER_COST_USD))
    throw new HttpError(503,"PRICE_OUT_OF_RANGE","Генерация временно недоступна по этой цене");
  const kopecks=cost.mul(c.FX_RUB_PER_USD).mul(c.PRICE_MARKUP).mul(100)
    .add(c.PRICE_FIXED_KOPECKS).ceil().toNumber();
  if(!Number.isSafeInteger(kopecks) || kopecks<=0 || kopecks>c.MAX_ORDER_KOPECKS)
    throw new HttpError(503,"PRICE_LIMIT","Стоимость превышает установленный лимит");
  return kopecks;
}
export function inputDigest(input: object): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
