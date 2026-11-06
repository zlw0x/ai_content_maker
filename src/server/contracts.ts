/**
 * Domain boundaries for M1/M2. Interfaces only: do not call paid APIs in M0.
 * Money is integer kopecks. Network submission and financial operations must be idempotent.
 */
export type GenerationState =
  | "reserved" | "queued" | "submitting" | "unknown"
  | "processing" | "completed" | "failed";

export type Quote = {
  id: string;
  appSlug: string;
  inputHash: string;
  priceKopecks: number;
  currency: "RUB";
  expiresAt: string;
};

export type ProviderPrediction = {
  providerId: string;
  status: "created" | "processing" | "completed" | "failed" | "cancelled" | "timeout" | "deleted";
  outputUrls: string[];
};

export interface AiProvider {
  /** Evaluate a validated, whitelisted app configuration on the server. */
  quoteCostUsd(modelId: string, input: Readonly<Record<string, unknown>>): Promise<string>;
  /** NEVER blind-retry when request acceptance is uncertain. */
  submit(modelId: string, input: Readonly<Record<string, unknown>>, callbackUrl: string): Promise<string>;
  getPrediction(predictionId: string): Promise<ProviderPrediction>;
}

export interface PaymentGateway {
  createTopup(amountKopecks: number, externalOrderId: string, idempotencyKey: string): Promise<{ id: string; confirmationUrl: string }>;
  getVerifiedPayment(paymentId: string): Promise<{ id: string; paid: boolean; amountKopecks: number }>;
}
