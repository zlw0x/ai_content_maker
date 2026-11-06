# Private user library and WaveSpeed staging

## Credential security

An API key pasted into a conversation is not a safe deployment secret, even if someone calls it a "test" key. Rotate/revoke the previously shared **live-prefix** credential in WaveSpeed and use a fresh key only in the server-side .env on a separate staging host. Never put a key in git, PRs, logs, NEXT_PUBLIC_ variables or screenshots.

## What was implemented

1. WaveSpeed Pricing API now receives {model_id, inputs}, including all parameters. The worker checks a fresh upstream quote BEFORE creating a paid prediction; when pricing changes upward or fails, it refuses submission and releases the reserved balance.
2. The provider prediction output URL stays on the server. Our worker copies up to 4 outputs to a private media volume.
3. Authenticated /api/v1/assets/:id checks user_id ownership for every read. `?view=1` uses safe inline media types, HTTP Range works for video/audio. SVG stays an attachment to prevent same-origin script execution.
4. Paginated /api/v1/library?kind=all|image|video|audio&page=0 gives only the current user's records and local asset paths.
5. /library has gallery, view/play/download, repeat prompts and deletion. DELETE /api/v1/library/:id hides a completed/failed job and immediately revokes file access, while preserving billing records. Uploaded images may be deleted separately through DELETE /api/v1/assets/:id if not used by an active/valid order.
6. Input expires after 7 days. New output files expire after OUTPUT_RETENTION_DAYS (default 30); worker removes expired or deleted files. Older files keep their original expiry.

## Local demo

Stay on:
```dotenv
WAVESPEED_MODE=mock
PAYMENT_MODE=disabled
DEMO_CREDIT_ENABLED=true
STAGING_MANUAL_CREDIT_ENABLED=false
OUTPUT_RETENTION_DAYS=30
```
```bash
docker compose up -d --build
docker compose ps
curl http://localhost:3000/api/v1/health/ready
```
Then register, get mock credit, generate, go to /library, preview/download/delete.

## One genuine paid inference on isolated staging

This is **operator setup**, NOT an automatic test run or authorization to spend. It must use a **new, rotated** key.

1. Use a **separate clean database** and a staging deployment (ideally another VPS). Do not reuse development volumes, the database with demo balances, or production customer accounts.
2. Create a new WaveSpeed API key, add a small provider balance, set an account-level budget cap.
3. Configure a new staging `.env` (keep secret values local, never commit):
```dotenv
WAVESPEED_MODE=live
WAVESPEED_API_KEY=YOUR_NEW_ROTATED_KEY
PAYMENT_MODE=disabled
ALLOW_LIVE_PAYMENTS=false
DEMO_CREDIT_ENABLED=false
STAGING_MANUAL_CREDIT_ENABLED=true
OUTPUT_RETENTION_DAYS=30
WORKER_CONCURRENCY=1
MAX_PROVIDER_COST_USD=0.02
MAX_ORDER_KOPECKS=1500
MAX_DAILY_SPEND_KOPECKS=1500
OUTPUT_HOST_ALLOWLIST=EXACT_VALIDATED_WAVESPEED_CDN_HOSTNAME
```
4. Validate output CDN hostname from real, verified provider documentation or a provider result, not from an arbitrary public URL. **Without the allowlist results are deliberately not downloaded.** Do not use a wildcard or private-network hostname.
5. Start staging web + worker using the isolated .env and database. Register a **new staging-only** user.
6. Operator manually credits at most 1000 kopecks in total to that account (no HTTP admin topup endpoint):
```bash
docker compose exec -T worker npm run staging:credit -- staging-user@example.com 800
```
7. Open /apps/text-to-image, quote 1024x1024 Z-Image Turbo. Check the RUB price and provider USD rate against the expected ceiling. Confirm exactly **one** order.
8. Observe job via /dashboard or /library and `docker compose logs --tail=100 worker`. On successful completion, check that media is downloaded privately, accessible only to that user, and the reserved RUB amount captured. Verify external actual cost against provider history.
9. Turn off STAGING_MANUAL_CREDIT_ENABLED after issuing the test credit; restart staging services to enforce the flag. Rotate the staging key after any accidental exposure.

## Safe failure behavior

- Lost response to paid submission => job `unknown`, user funds stay reserved. **Never auto-resubmit.**
- Upstream pricing changed/increased or unavailable before submission => release reservation and mark failed.
- Upstream `completed` but media cannot be fetched => worker retries the safe GET/download, not the paid POST.
- Asset permissions are checked every time, including Range requests and inline previews. No public CDN URLs are given to the browser.

## Remaining production milestones

- Verified real WaveSpeed provider request for each of the 10 app mappings, especially image-to-image and premium models; some presets may need model-specific corrections.
- Confirm the precise output CDN domains and content formats during staging.
- Bank payment sandbox/refunds/receipts; verified email, password reset and abuse protections.
- Backups/restore and monitoring, S3 for multi-host hosting, production threat review and commercial/compliance decisions.
