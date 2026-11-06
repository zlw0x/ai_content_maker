import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().startsWith("postgresql://").or(z.string().startsWith("postgres://")),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  STORAGE_DIR: z.string().default("./private-media"),
  WAVESPEED_MODE: z.enum(["mock", "live"]).default("mock"),
  WAVESPEED_API_KEY: z.string().optional(),
  WAVESPEED_WEBHOOK_SECRET: z.string().optional(),
  WAVESPEED_CALLBACK_URL: z.string().url().optional(),
  PAYMENT_MODE: z.enum(["disabled", "yookassa"]).default("disabled"),
  ALLOW_LIVE_PAYMENTS: z.enum(["true", "false"]).default("false"),
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
  FX_RUB_PER_USD: z.coerce.number().positive().default(90),
  PRICE_MARKUP: z.coerce.number().min(1).max(20).default(2.2),
  PRICE_FIXED_KOPECKS: z.coerce.number().int().min(0).default(500),
  MAX_PROVIDER_COST_USD: z.coerce.number().positive().default(3),
  MAX_ORDER_KOPECKS: z.coerce.number().int().positive().default(100000),
  MAX_DAILY_SPEND_KOPECKS: z.coerce.number().int().positive().default(200000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).default(3000),
  MOCK_COST_USD: z.coerce.number().positive().default(0.005),
  DEMO_CREDIT_ENABLED: z.enum(["true","false"]).default("false"),
  OUTPUT_HOST_ALLOWLIST: z.string().default(""),
  OUTPUT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  STAGING_MANUAL_CREDIT_ENABLED: z.enum(["true","false"]).default("false")
});
export type Config = z.infer<typeof schema>;
let cached: Config | undefined;

export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) throw new Error("Invalid server env: " + parsed.error.issues.map(i => i.path.join(".") + ": " + i.message).join(", "));
    cached = parsed.data;
    if (cached.WAVESPEED_MODE === "live" && !cached.WAVESPEED_API_KEY)
      throw new Error("WAVESPEED_API_KEY required for live mode");
    if (cached.PAYMENT_MODE === "yookassa" &&
      (!cached.YOOKASSA_SHOP_ID || !cached.YOOKASSA_SECRET_KEY || cached.ALLOW_LIVE_PAYMENTS !== "true"))
      throw new Error("YooKassa payments require SHOP_ID, SECRET_KEY and explicit ALLOW_LIVE_PAYMENTS=true");
  }
  return cached;
}
