# MVP review and completion — PR #10

## Findings and fixes

- Missing browser user journey: connected account, login, dashboard, wallet, upload, quote, order, status, downloads.
- Terminal mock UX: one-time 500 RUB synthetic credit, never while live WaveSpeed or real payments enabled.
- API and UI mismatch: 5/8-second video and RU MiniMax voice IDs now agree.
- Premium image was the same Z-Image model with a PNG setting; now maps to a distinct Seedream V5.0 Pro (requires real quality testing).
- Output downloads from upstream risk SSRF; live-only exact host allowlist enforced.
- Multiple result artifacts previously not persisted; now supports up to four indexed outputs with deduplication.
- Demo credit in a reused DB could pay for real upstream calls; live orders reject users with dev credits.
- Backend smoke tests extended to use the mock credit endpoint and Russian voices.

## Verified contracts from WaveSpeed

- https://wavespeed.ai/docs/pricing-api — POST model/price with model_id + input
- https://wavespeed.ai/docs/upload-files-api — signed upload ticket and PUT to provider URL
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/wan-2.2-image-to-video — duration 5/8, resolution 480p/720p
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/wan-2.2-t2v-480p — duration 5/8, size 832*480 / 480*832
- https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v5.0-pro — aspect_ratio, resolution, format
- https://wavespeed.ai/docs/docs-api/minimax/minimax_speech_voice_id — RU voice IDs

## Still excluded from production readiness

- Live WaveSpeed credential-backed tests and billing reconciliation
- YooKassa test-shop payment/receipt/refund verification
- Email ownership confirmation and password recovery
- Operational backup/restore, media retention review and threat modeling
- Browser E2E/visual checks beyond API smoke and Next.js build
- License/commercial agreements and jurisdictional obligations (deferred by project owner)
