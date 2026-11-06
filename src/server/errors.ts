export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new HttpError(status,code,message);
}
export function publicError(error: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (error instanceof HttpError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  console.error("Uncaught API error", error instanceof Error ? error.message : "unknown");
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервиса" } } };
}
