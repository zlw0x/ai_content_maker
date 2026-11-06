# Backend deployment — single VPS

This is an infrastructure preview, not a public production acceptance checklist.

## Locally

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD and DATABASE_URL to the same new secret.
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:3000/api/v1/health/ready
```

Services: `db` (PostgreSQL), `migrate` (one-shot), `web` (Next.js API + UI), `worker` (queue processing). Private files live in the named `media` volume.

By design, web and PostgreSQL ports are bound only to localhost. To expose the web service use a configured reverse proxy (TLS, upload body cap, rate limiting).

## Mock testing

Mock mode is default. Real WaveSpeed billing and YooKassa transactions are disabled.

```bash
# local Node (not the production container):
npm run dev:credit -- demo@example.com 50000
```

For Docker test seed, execute the CLI with an explicit non-production environment in a one-shot container, and only while both modes are mock/disabled:

```bash
docker compose run --rm -e NODE_ENV=development --no-deps worker npm run dev:credit -- demo@example.com 50000
```

Do not enable this on an internet-facing production instance.

## Live integration (staging only)

1. Configure `WAVESPEED_MODE=live`, `WAVESPEED_API_KEY` and optional standard webhook URL/secret; then do a budget-capped staging test.
2. Explicitly configure YooKassa only after verifying the account/shop setup: `PAYMENT_MODE=yookassa`, `ALLOW_LIVE_PAYMENTS=true`, `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`.
3. Make sure `APP_ORIGIN` matches your actual HTTPS origin.
4. Media outputs are retained only 7 days by default and are purged in worker.
5. Back up DB and media volume together. Verify restore before exposing paid use.

## Limits / caveats

- Dockerfile intentionally uses `npm install`, because repo does not yet include a lockfile; freeze it and switch to `npm ci` for reproducible release builds.
- The worker uses PostgreSQL polling; this setup assumes one worker process.
- An uncertain upstream submit remains in `unknown`. Run `npm run reconcile -- list` and only attach a verified existing provider prediction. Do not re-submit.
- Payments stuck in `unknown` need operational reconciliation with YooKassa. Never blindly create a second payment.
- Auth password reset, email verification, fiscalization, refund API, additional output artifacts and automated integration tests against real providers are not complete.
