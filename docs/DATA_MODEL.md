# Модель данных / финансовые инварианты

Файл `database/001_init.sql` — черновая миграция для просмотра и следующего этапа. Пока не подключена к приложению.

## Сущности

- `users` — пользователь и идентификатор для авторизации (в MVP email); хранить и обрабатывать согласно требованиям законодательства.
- `wallet_accounts` — агрегированные available/reserved копейки. Обновление ТОЛЬКО транзакционно.
- `wallet_ledger` — неизменяемый журнал операций: topup, reserve, release, capture, refund, adjustment.
- `payments` — платежи ЮKassa с status, внешним payment id, строго idempotent обработкой.
- `generation_jobs` — источник правды по AI-заказам, status, quote, provider_prediction_id, сроки и бюджеты.
- `media_assets` — ссылки на собственное объектное хранилище, owner, срок удаления.

Цены хранятся в integer копейках, расчётная себестоимость — decimal, а не float для денег.

## Инварианты

1. available_kopecks >= 0; reserved_kopecks >= 0.
2. Уникальный `user_id + client_idempotency_key` для заказа.
3. Уникальный `provider + external_payment_id` для платежа.
4. Один reserve/charge/refund по одному и тому же финансовому событию; повторный webhook безопасен.
5. Подтверждение заказа и резервирование денег — одна транзакция.
6. Списывать резерв по факту завершения; при неопределённом upstream запросе удерживать резерв до сверки.
7. `wallet_ledger` append-only (запрет UPDATE/DELETE на уровне приложения/ролей), все поправки — компенсирующие записи.
8. Без авторизации нельзя получить чужие входы/выходы.
9. Сроки хранения файлов задаёт политика retention, а не истечение URL поставщика.

## Пример атомарного резерва

```sql
BEGIN;
UPDATE wallet_accounts
SET available_kopecks = available_kopecks - :amount,
    reserved_kopecks = reserved_kopecks + :amount
WHERE user_id = :user_id AND available_kopecks >= :amount
RETURNING user_id;
-- If no row returned, ROLLBACK (недостаточно средств).
-- INSERT generation_jobs и INSERT wallet_ledger в той же транзакции.
COMMIT;
```

В настоящем коде использовать параметризованные запросы и проверку row count. Это пример, а не готовая процедура.

## Хранение/ретеншн

Публичные URL выводов провайдера могут истекать. MediaStorage копирует output внутрь защищённого bucket, проверяет размер/тип и возвращает пользователю подписанную ссылку. TTL для пользовательских медиа — отдельное решение и политика обработки персональных данных. Транзакционную историю хранить по отдельным правовым требованиям.
