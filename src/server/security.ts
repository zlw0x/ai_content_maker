import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { config } from "./config";
import { db, one } from "./db";
import { assert, HttpError } from "./errors";

const scrypt = promisify(scryptCb);
const SESSION_COOKIE = "acm_session";
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, Buffer.from(salt,"hex"), 64) as Buffer;
  return salt + ":" + hash.toString("hex");
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(digest)) return false;
  const actual = await scrypt(password, Buffer.from(salt,"hex"), 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(digest,"hex"));
}

export function sameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && origin !== config().APP_ORIGIN) throw new HttpError(403,"BAD_ORIGIN","Запрос с другого сайта запрещён");
  if (fetchSite === "cross-site") throw new HttpError(403,"BAD_ORIGIN","Запрос с другого сайта запрещён");
}
export async function currentUser(): Promise<{ id: string; email: string }> {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value;
  assert(secret && secret.length >= 30,401,"AUTH_REQUIRED","Требуется вход");
  const user = await one<{id:string;email:string}>(`
    SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_sha256=$1 AND s.expires_at>now() AND u.deleted_at IS NULL
  `,[sha256(secret)]);
  assert(user,401,"AUTH_REQUIRED","Сессия истекла");
  return user;
}
export async function beginSession(userId: string): Promise<void> {
  const secret = token();
  await db().query("INSERT INTO sessions(user_id,token_sha256,expires_at) VALUES($1,$2,now()+interval '14 days')",
    [userId,sha256(secret)]);
  (await cookies()).set(SESSION_COOKIE,secret,{httpOnly:true,sameSite:"lax",secure:config().APP_ORIGIN.startsWith("https://"),path:"/",maxAge:14*24*3600});
}
export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const secret = cookieStore.get(SESSION_COOKIE)?.value;
  if (secret) await db().query("DELETE FROM sessions WHERE token_sha256=$1",[sha256(secret)]);
  cookieStore.delete(SESSION_COOKIE);
}
export async function rateLimit(key: string, maxFailures: number): Promise<void> {
  const digest = sha256(key);
  const row = await one<{fail_count:number}>(`SELECT fail_count FROM auth_attempts WHERE key_digest=$1 AND window_start>now()-interval '15 minutes'`,[digest]);
  assert(!row || row.fail_count < maxFailures,429,"AUTH_RATE_LIMIT","Слишком много попыток. Попробуйте позже");
}
export async function recordFailure(key: string): Promise<void> {
  await db().query(`
    INSERT INTO auth_attempts(key_digest,fail_count,window_start) VALUES($1,1,now())
    ON CONFLICT(key_digest) DO UPDATE SET
    fail_count=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_attempts.fail_count+1 END,
    window_start=CASE WHEN auth_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE auth_attempts.window_start END
  `,[sha256(key)]);
}
