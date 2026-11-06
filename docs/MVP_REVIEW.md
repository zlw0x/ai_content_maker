# MVP completion: audit and acceptance plan

Status: in progress (PR review branch). Date: 2026-11-06.

## Scope

1. Connect existing catalog and app pages to auth, file upload, server quotes, wallet and jobs.
2. Review payment, ledger, concurrency, media and WaveSpeed integrations. Fix reproducible problems first.
3. Freeze dependencies and add automated tests for end-to-end mock flow and error paths.
4. Keep third-party billing disabled by default; flag unverified live integrations clearly.
5. Deliver a reproducible demo deployment and an honest release-readiness checklist.

## Acceptance

- User can register, log in, log out, upload a supported image, obtain a server quote, confirm an idempotent order and download a mock result without curl.
- Job and wallet state are visible; duplicate submissions and stale quotes do not double-charge.
- Automated typecheck, unit, smoke, build, docker config pass.
- No API secrets in browser; no real payment unless explicitly configured and tested.
- Remaining release blockers are documented, not disguised as completed.

See docs/ROADMAP.md for prior phases.
