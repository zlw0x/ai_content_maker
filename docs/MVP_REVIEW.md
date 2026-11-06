# MVP review and completion

Date: 2026-11-06. PR #10. Status: in progress.

## Acceptance
- [x] Connect auth UI / dashboard / app generator to existing REST API.
- [x] Add a one-time mock-only RUB credit for browser test flow.
- [ ] Verify newest CI on the final PR commit (types, migration, tests, build, Docker config).
- [ ] Reconcile model parameters against WaveSpeed docs and document provider limitations.
- [ ] Audit concurrency, idempotency, media/file safety and payment fail-closed behavior.
- [ ] Update instructions and check a reproducible browser-first test.

## Explicit non-goals for this PR
- Real bank payment activation, fiscal receipts, public production go-live.
- Claiming quality of untested model generations.
- Multi-provider router, native mobile app, Kubernetes.

## Checklist of verified sources
- https://wavespeed.ai/docs/pricing-api
- https://wavespeed.ai/docs/upload-files-api
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/wan-2.2-image-to-video
- https://wavespeed.ai/docs/docs-api/minimax/minimax-speech-2.6-hd
