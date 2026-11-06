# AI Content Maker

Русскоязычный каталог AI-приложений. Backend — Next.js API + PostgreSQL + отдельный worker. Поддерживаются модельные адаптеры WaveSpeed, серверное ценообразование, учёт денег и адаптер ЮKassa/СБП. Все внешние платные операции **по умолчанию выключены**.

## Быстрый запуск: backend в безопасном mock-режиме

**Нужно:** Node.js 22+, npm, Docker + Compose.

```bash
cp .env.example .env
# Change POSTGRES_PASSWORD and DATABASE_URL together in .env
docker compose up -d db
npm install
npm run db:migrate
npm run dev
# in another terminal:
npm run worker
```

Открой http://localhost:3000. Каталог всё ещё показывает UI-демо, пока фронтенд не подключён к новым backend endpoint. Backend уже доступен по `/api/v1/*`.

Для тестирования через REST:
1. `POST /api/v1/auth/register` JSON `{"email":"demo@example.com","password":"a-very-long-test-password"}`; сохраните HTTP-only cookie.
2. `GET /api/v1/apps`, `GET /api/v1/wallet`.
3. Локально зачислите тестовый баланс: `npm run dev:credit -- demo@example.com 50000` (500 ₽ **только** для mock-mode).
4. `POST /api/v1/quotes`: `{"appSlug":"text-to-image","input":{"prompt":"Футуристический город"}}`.
5. `POST /api/v1/orders`: `{"quoteId":"uuid из котировки"}`, с `Idempotency-Key: <новый UUID>`.
6. `GET /api/v1/orders/{id}` — worker завершит задачу и вернёт `outputs[0].url`, по которому можно скачать тестовый SVG.

Для проверки алгоритма и тестовых запросов: `npm run test:unit`, `npm run test:smoke` (последний требует запущенные сервер, worker и PostgreSQL).

## Endpoints

```
GET  /api/v1/health
GET  /api/v1/health/ready
GET  /api/v1/apps
GET  /api/v1/apps/:slug
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/assets                # multipart/form-data file=<png/jpg/webp>
GET  /api/v1/assets/:id            # private download
POST /api/v1/quotes                # server-side quote
POST /api/v1/orders                # Idempotency-Key
GET  /api/v1/orders
GET  /api/v1/orders/:id
GET  /api/v1/wallet
POST /api/v1/topups                # disabled by default; Idempotency-Key
GET  /api/v1/topups/:id
POST /api/webhooks/wavespeed       # Standard Webhooks HMAC
POST /api/webhooks/yookassa        # independently verified via provider GET
```

## Backend status

| Component | State |
|---|---|
| PostgreSQL migrations, accounts and sessions | Implemented |
| Local private input/output storage | Implemented (single-VPS mode) |
| Server quotes, order idempotency, wallet ledger | Implemented |
| Worker + submission uncertainty safety | Implemented; unknown jobs require manual reconciliation |
| Mock provider end-to-end test | Implemented |
| Live WaveSpeed adapters | Implemented for 8 scenarios; require funded API key and measured integration |
| YooKassa SBP adapter | Implemented; disabled until explicitly enabled/configured |
| Full UI integration | Not yet: forms still M0 demo |
| Automated fiscal receipts & real refunds | Not implemented |
| Multiple-output persistence | Not yet (worker stores first output only) |
| Production-grade email verification & password reset | Not yet |
| Horizontal scaling, object storage, observability | Not yet |

**Do not treat this as production-ready financial software.** Security and operational controls need staging tests and review before serving real users or accepting actual money.

## Documentation

- [Backend implementation & API examples](docs/BACKEND.md)
- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data & financial rules](docs/DATA_MODEL.md)
- [Pricing](docs/PRICING.md)
- [Security checklist](docs/SECURITY_COMPLIANCE.md)
- [Roadmap](docs/ROADMAP.md)

## Data and secrets

All secrets only in server environment. Do not use `NEXT_PUBLIC_` for API keys. `.env` and `private-media` are gitignored. Restrict DB port to localhost, use HTTPS, back up DB and file volume.

The repo is currently public and has no OSI license. Copyright and deployment conditions require separate decisions.
