import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "./config";
import { transaction } from "./db";
import { assert } from "./errors";

function delivery() {
  const c = config();
  if (c.RECIPE_EMAIL_DELIVERY === "mock" && c.WAVESPEED_MODE === "mock" && c.PAYMENT_MODE === "disabled") {
    return { mode: "mock" as const, secret: "local-only-verification" };
  }
  if (c.RECIPE_EMAIL_DELIVERY === "webhook" && c.RECIPE_EMAIL_WEBHOOK_URL && c.RECIPE_EMAIL_WEBHOOK_SECRET) {
    const url = new URL(c.RECIPE_EMAIL_WEBHOOK_URL);
    if (url.protocol === "https:" && !url.username && !url.password) {
      return { mode: "webhook" as const, url, secret: c.RECIPE_EMAIL_WEBHOOK_SECRET };
    }
  }
  return null;
}

const digest = (userId: string, code: string, secret: string) => createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex");

export async function startEmailVerification(userId: string) {
  const sender = delivery();
  assert(sender, 503, "EMAIL_VERIFICATION_DISABLED", "Отправка кода пока недоступна");
  const code = String(randomInt(100000, 1000000));
  const email = await transaction(async client => {
    const { rows: [user] } = await client.query<{ email: string; verified: boolean }>(`SELECT email, email_verified_at IS NOT NULL AS verified
      FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [userId]);
    assert(user && !user.verified, 409, "EMAIL_ALREADY_VERIFIED", "Почта уже подтверждена");
    const saved = await client.query(`INSERT INTO email_verifications (user_id, code_digest) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET code_digest=excluded.code_digest, attempts=0, created_at=now(),
        expires_at=excluded.expires_at,
        sends=CASE WHEN email_verifications.send_window<now()-interval '15 minutes' THEN 1 ELSE email_verifications.sends+1 END,
        send_window=CASE WHEN email_verifications.send_window<now()-interval '15 minutes' THEN now() ELSE email_verifications.send_window END
      WHERE email_verifications.created_at<now()-interval '1 minute'
        AND (email_verifications.sends<3 OR email_verifications.send_window<now()-interval '15 minutes')
      RETURNING user_id`, [userId, digest(userId, code, sender.secret)]);
    assert(saved.rowCount, 429, "EMAIL_SEND_LIMIT", "Повторите отправку позже");
    return user.email;
  });
  if (sender.mode === "mock") return { delivery: "mock" as const, demoCode: code };
  const response = await fetch(sender.url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${sender.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: email, subject: "Код подтверждения Сделано AI", text: `Ваш код: ${code}. Он действует 10 минут.` }),
  }).catch(() => null);
  assert(response?.ok, 502, "EMAIL_DELIVERY_FAILED", "Письмо не отправлено. Попробуйте позже");
  return { delivery: "email" as const };
}

export async function confirmEmailVerification(userId: string, raw: unknown) {
  const sender = delivery();
  assert(sender, 503, "EMAIL_VERIFICATION_DISABLED", "Подтверждение почты недоступно");
  const input = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict().safeParse(raw);
  assert(input.success, 422, "EMAIL_CODE_INVALID", "Введите шестизначный код");
  const expected = digest(userId, input.data.code, sender.secret);
  const verified = await transaction(async client => {
    const account = await client.query<{ verified: boolean }>(`SELECT email_verified_at IS NOT NULL AS verified
      FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [userId]);
    if (account.rows[0]?.verified) return true;
    const { rows: [challenge] } = await client.query<{ code_digest: string }>(`UPDATE email_verifications
      SET attempts=attempts+1 WHERE user_id=$1 AND attempts<5 AND expires_at>now() RETURNING code_digest`, [userId]);
    if (!challenge || !timingSafeEqual(Buffer.from(challenge.code_digest, "hex"), Buffer.from(expected, "hex"))) return false;
    await client.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [userId]);
    await client.query("DELETE FROM email_verifications WHERE user_id=$1", [userId]);
    return true;
  });
  assert(verified, 422, "EMAIL_CODE_INVALID", "Код неверен или больше не действует");
  return { verified };
}
