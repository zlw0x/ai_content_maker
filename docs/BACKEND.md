# Backend implementation — M1/M2 technical guide

## Modes

- `WAVESPEED_MODE=mock` + `PAYMENT_MODE=disabled`: local full request cycle with simulated low-cost estimates and SVG output.
- `WAVESPEED_MODE=live`: model-specific API requests, WaveSpeed Pricing API, direct media uploads, result polling, signed webhook hints.
- `PAYMENT_MODE=yookassa`: creates SBP redirect payments; requires `ALLOW_LIVE_PAYMENTS=true` and YOOKASSA credentials. **Real payments must not be switched on merely to test the code.**

## Enabled model mapping

| App | WaveSpeed ID | Status |
|---|---|---|
| text-to-image | wavespeed-ai/z-image/turbo | integrated |
| premium-image | wavespeed-ai/z-image/turbo (PNG variant) | integrated; quality differentiation not demonstrated |
| photo-editor | wavespeed-ai/z-image/turbo (image input) | integrated |
| background-swap | same | workflow preset; quality requires testing |
| ai-portrait | same | workflow preset |
| product-shot | same | workflow preset |
| photo-to-video | wavespeed-ai/wan-2.2/image-to-video | integrated |
| text-to-video | wavespeed-ai/wan-2.2/t2v-480p | integrated |
| ai-voiceover | - | disabled: select validated audio model later |
| upscale | - | disabled: select validated upscale model later |

Live adapter integration is unverified without a funded WaveSpeed account. The API docs may change; check model schemas before money is spent.

## REST examples (curl)

```bash
BASE=http://localhost:3000
curl -c cookies.txt -H 'Content-Type: application/json' -X POST \
  "$BASE/api/v1/auth/register" -d '{"email":"demo@example.com","password":"a-very-long-test-password"}'

curl -b cookies.txt -F "file=@./example.png" "$BASE/api/v1/assets"
# use returned image id in imageAssetId for image-based apps

curl -b cookies.txt -H 'Content-Type: application/json' -X POST "$BASE/api/v1/quotes" \
  -d '{"appSlug":"text-to-image","input":{"prompt":"Cinematic sunset in a quiet city"}}'
# Read quote UUID from the response. Generate a UUID for Idempotency-Key.

curl -b cookies.txt -H 'Content-Type: application/json' \
  -H "Idempotency-Key: YOUR-UUID" -X POST "$BASE/api/v1/orders" -d '{"quoteId":"QUOTE-UUID"}'

curl -b cookies.txt "$BASE/api/v1/orders/ORDER-UUID"
```

Do not commit `cookies.txt`.

## Money/state flows

- A quote is persisted with input digest and upstream price before funds are reserved. Each quote is usable once.
- Confirmation locks the quote row, inserts job and reserves cash in a single transaction.
- Worker claims the job once, submits to provider exactly once, and polls by provider ID.
- No provider ID after a timeout/network error -> `unknown`. Never auto-submit again. Human review is required before resolving unknown.
- A verified completed result is copied to private disk; reserved amount is then captured.
- A verified terminal error releases reserve.
- YooKassa webhooks are treated as a trigger to query the real payment status/amount/currency/metadata via authenticated API. Then ledger credits exactly once.

## Remaining deployment and testing work

- Migrate media storage to S3/RU-compatible object store before multi-host deployment.
- Implement reconciliation interface for jobs with unknown provider acceptance and for partial output persistence.
- Upgrade session/auth with verified email/password reset, DB cleanup of expired sessions, additional abuse protection.
- Audit payment receipts, refunds and customer communication before enabling real funds.
- Tune per-app model parameters and price ceilings using live measured costs.
- Add operational dashboards, backups and restore test, intrusion/abuse alerting.
- Use one worker process in this phase; multiple worker instances require global concurrency locking.
- Apply rate limits at reverse proxy for uploads and credential endpoints.

Docs: https://wavespeed.ai/docs/pricing-api , https://wavespeed.ai/docs/submit-task , https://wavespeed.ai/docs/upload-files-api , https://wavespeed.ai/docs/verify-webhooks , https://yookassa.ru/developers/payment-acceptance/integration-scenarios/manual-integration/other/sbp
