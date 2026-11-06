export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch("/api/v1" + path, {
    credentials: "same-origin", cache: "no-store",
    ...init,
    headers: { ...(init.body instanceof FormData ? {} : {"Content-Type":"application/json"}), ...init.headers }
  });
  const data: unknown = await res.json().catch(()=>null);
  if (!res.ok) {
    const error = data as {error?:{message?:string;code?:string}}|null;
    throw new ApiError(error?.error?.message ?? "Ошибка сервера ("+res.status+")",
      res.status,error?.error?.code ?? "API_ERROR");
  }
  return data as T;
}
export function rub(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU",{style:"currency",currency:"RUB",maximumFractionDigits:2}).format(kopecks/100);
}
export function safeNext(raw: string|null, fallback="/dashboard"):string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : fallback;
}
export type AppJob = {
  id:string; appSlug:string; status:string; priceKopecks:number;
  createdAt:string; finishedAt:string|null; errorCode:string|null;
};
export type JobDetail=AppJob&{outputs:{id:string;mediaType:string;url:string}[]};
