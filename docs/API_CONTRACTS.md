# Черновые внутренние API-контракты (НЕ реализованы)

API под `/api/v1`. Клиент получает цены/статусы только с сервера. Ни одна из перечисленных ручек пока не подключена в M0.

## Публичное

```http
GET /api/v1/apps
GET /api/v1/apps/:slug
POST /api/v1/quotes
Content-Type: application/json
{"appSlug":"photo-to-video","input":{"durationSeconds":5,"quality":"720p"}}
```

Quote response:

```json
{"id":"quote_uuid","appSlug":"photo-to-video","priceKopecks":9900,"currency":"RUB","expiresAt":"ISO-8601","inputHash":"sha256"}
```

## Авторизованное

```http
POST /api/v1/orders
Idempotency-Key: client-generated-uuid
{"quoteId":"quote_uuid","inputRef":"asset_uuid"}

GET /api/v1/orders/:id
GET /api/v1/orders
GET /api/v1/wallet
POST /api/v1/payments/topups
Idempotency-Key: client-generated-uuid
{"amountKopecks":19900}
```

Order response:

```json
{"id":"order_uuid","status":"queued","priceKopecks":9900,"remainingBalanceKopecks":10000,"outputs":[]}
```

## Внешние webhook handlers

```http
POST /api/webhooks/wavespeed
POST /api/webhooks/yookassa
```

Handlers должны проверять подпись/достоверность по правилам провайдера; на endpoint никогда нельзя принимать произвольные статусы и суммы на веру. Нужен аудит, replay protection, idempotency и reconciliation. Важно: возможность проверять платежи через ЮKassa API не заменяет ограничения доступа к endpoint.

## Ошибки

```json
{"error":{"code":"INSUFFICIENT_FUNDS","message":"Недостаточно средств","requestId":"..." }}
```

Статусы: `400` ошибочный ввод, `401` вход, `403` права, `404` неизвестный App, `409` quote expired/conflict, `422` неверные параметры, `429` лимит, `503` провайдер недоступен. Ни один клиентский запрос не передаёт raw model id, произвольный внешний URL или настоящую цену.
