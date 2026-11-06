# Live WaveSpeed staging + private media milestone

Work in PR on a separate branch. **Never commit keys**; rotate any key pasted in chat.

## Scope
- Repair WaveSpeed request pricing payload (`inputs`, not `input`).
- Recheck cost server-side immediately before paid submission; fail closed if price changed.
- Private media library, previews without exposing upstream URLs, video/audio streaming with Range.
- Authenticated ownership checks for media, gallery, deletion; restore prompt for re-generation.
- Output retention 30 days, input retention 7 days, cleanup.
- Staging-only manual credit CLI; no public credit endpoint in live mode.
- Unit + integration + browser tests including cross-user access denial.

## Acceptance
- CI migrations, typecheck, build, unit, mock API and Playwright pass.
- New media endpoints return 404 for other users and expired/deleted assets.
- No external WaveSpeed URLs in client API payloads.
- One live generation requires rotated WaveSpeed API key configured **on server** by owner and a distinct staging PostgreSQL database.

## Non-goals for this milestone
- Real SBP / receipts, commercial/legal launch, email verification, unlimited storage.
