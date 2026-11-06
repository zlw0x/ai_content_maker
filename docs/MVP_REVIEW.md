# MVP Code Review — PR #10

Обновлено: 2026-11-06

## Реализовано
- Полный browser flow: регистрация → демонстрационный баланс → создание серверной quote → атомарное резервирование → worker → история → скачивание.
- 10 AI Apps с server allowlist и строгими схемами: text/image/video/voice/upscale.
- Две реальные модельные линейки для обычного/Pro фото: Z-Image Turbo и Seedream V5.0 Pro; качество требует отдельного live теста.
- Исправлены варианты длительности видео, поддержка русских голосов MiniMax.
- Идемпотентность заказов (ключ + quote) и одноразовый demo credit.
- В live-режиме пользователь с тестовым балансом не может заказать реальную генерацию.
- Output URL из провайдера проверяется по точному hostname allowlist; для нескольких результатов сохраняются индексы (до 4).
- Миграции, TypeScript, unit/smoke и browser tests выполняются в CI.

## Существенные риски и отсроченные задачи

| Риск | Решение для MVP | Что нужно до production |
|---|---|---|
| Неизвестный результат submit | Статус unknown; нет слепого повтора | Операционная сверка/компенсация |
| Нет подтверждения email | Вход с паролем и серверной сессией | Email verification/reset и антиабуз |
| Оплата | Только mock; real ЮKassa disabled | Тест-магазин, idempotency, возвраты, чеки |
| Перепродажа API | Не проверялась | Проверка условий в финальной стадии |
| Live модели | Схемы проверены по docs | Настоящие тестовые запросы и замер стоимости |
| Доступность и масштабирование | Один Next + worker + PG | Backups/restore, monitoring, масштабирование |
| CDN медиа | Explicit hostname allowlist | Подтвердить допустимые output hosts, S3 |
| Загрузка файлов | Signature check, size 10 MB | Декодирование, anti-malware, proxy limit |
| Данные пользователей | Входные файлы 7 дней, новые результаты по умолчанию 30 дней, доступ только владельцу | Отдельные правила хранения и согласия |

## Источники схем WaveSpeed

- https://wavespeed.ai/docs/pricing-api
- https://wavespeed.ai/docs/upload-files-api
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/z-image-turbo
- https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedream-v5.0-pro
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/wan-2.2-image-to-video
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/wan-2.2-t2v-480p
- https://wavespeed.ai/docs/docs-api/minimax/minimax_speech_voice_id

Документ о выполненных проверках не заменяет staging-проверку с настоящими ключами.
