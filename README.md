# AI Content Maker

Русскоязычный каталог из 10 AI-инструментов: изображения, редактирование фото, фото/текст → видео, реклама, русская озвучка и upscale. Backend: Next.js, PostgreSQL, отдельный worker. Предусмотрены WaveSpeed API и ЮKassa/СБП.

**Статус:** функциональный MVP в безопасном **mock-режиме**. Внешние API и реальные платежи по умолчанию отключены. «Генерации» в mock возвращают демонстрационный SVG, а не контент из нейросети.

## Запуск (Docker)

Требуется Docker Engine + Docker Compose.

```bash
git clone https://github.com/zlw0x/ai_content_maker.git
cd ai_content_maker
cp .env.example .env
# Измените POSTGRES_PASSWORD в .env (не коммитьте файл).
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:3000/api/v1/health/ready
```

Откройте **http://localhost:3000** на том же ПК. На VPS порт по умолчанию слушает только `127.0.0.1`; для удалённого теста используйте SSH-туннель или HTTPS reverse proxy.

## Первый сценарий в браузере

1. Открыть `/account`, создать учётную запись (пароль от 12 символов).
2. В `/dashboard` нажать **«Получить тестовые 500 ₽»** — один раз на пользователя.
3. В каталоге выбрать, например, «Генератор изображений»; ввести описание.
4. Нажать **«Рассчитать стоимость»**. Сервер создаёт котировку с TTL 10 минут.
5. Подтвердить заказ; деньги резервируются атомарно.
6. Открывается `/dashboard`: дождаться статуса «Готово», скачать тестовый файл. История и остаток баланса доступны там же.

Для инструментов на основе изображений используйте JPEG, PNG или WebP до 10 MB. В mock-режиме настоящий исходник не анализируется.

## Доступные маршруты

- `/` — каталог, поиск, категории
- `/apps/[slug]` — формы 10 приложений
- `/account` — регистрация и вход
- `/dashboard` — тестовый баланс, история и статусы заказов
- `/library` — приватная медиатека: галерея, защищённые превью, потоковое видео/аудио, скачивание, повтор и удаление
- `/api/v1/` — авторизация, котировки, заказы, файлы, платежи
- `/api/webhooks/` — callback WaveSpeed / ЮKassa

## Режимы и безопасность

| Настройка | Для локального MVP |
|---|---|
| `WAVESPEED_MODE` | `mock` |
| `PAYMENT_MODE` | `disabled` |
| `DEMO_CREDIT_ENABLED` | `true` |
| `ALLOW_LIVE_PAYMENTS` | `false` |

Тестовые деньги никогда не должны попадать в базу реального сервиса. Live-заказы дополнительно запрещены для пользователей с тестовыми пополнениями.

Для live WaveSpeed нужны ключ, ограниченный бюджет, тесты реальных параметров моделей и `OUTPUT_HOST_ALLOWLIST` (точные CDN hostname). Реальное подключение платежей требует отдельной проверки и явного включения. **Не переводите демонстрационную базу и данные в production.**

## Разработка

Node.js 22+, PostgreSQL 17+:

```bash
npm ci
npm run db:migrate
npm run dev
# В другом терминале:
npm run worker
npm run test:unit
```

`npm run test:smoke` требует запущенные web, worker и PostgreSQL, а `npm run test:e2e` — установленный Playwright Chromium.

## Документация

- [Подробное развёртывание](docs/DEPLOYMENT.md)
- [Backend и API](docs/BACKEND.md)
- [Обзор ревью и исправления](docs/MVP_REVIEW.md)
- [Архитектура](docs/ARCHITECTURE.md)
- [Инварианты финансового учёта](docs/DATA_MODEL.md)
- [Экономика](docs/PRICING.md)
- [Безопасность](docs/SECURITY_COMPLIANCE.md)
- [План этапов](docs/ROADMAP.md)

### Не готово для публичного коммерческого запуска

Live end-to-end тесты с реальными API, подтверждение email/сброс пароля, боевые платежи/возвраты/фискализация, масштабируемое хранилище, резервное восстановление и некоторые операционные защитные механизмы. Эти ограничения описаны в [review](docs/MVP_REVIEW.md) и [backend](docs/BACKEND.md).


## Live staging and private library

See [WaveSpeed live staging and user-owned media instructions](docs/LIVE_STAGING_CHECKLIST.md). Do not deploy a key previously pasted into chat. A true provider API test must use a newly rotated key from a private server-side secret.

## Подтверждённые тесты и инженерный аудит

В CI есть два независимых прохода: Node unit/API/Playwright и **полный Docker Compose** (PostgreSQL + миграции + web + worker, реальные HTTP smoke и Playwright в mock). Это не эквивалент paid WaveSpeed inference. См. [технический аудит от 06.11.2026](docs/AUDIT_2026-11-06.md), [staging-инструкцию](docs/LIVE_STAGING_CHECKLIST.md).


## Windows: готовый пакет для одного реального теста

Скачайте ZIP репозитория, распакуйте и запустите **`01_START_HERE.cmd`**. После успешной проверки API — **`02_RUN_ONE_TEST.cmd`** для одной оплаченной генерации с отдельным staging-пользователем. Полные инструкции на русском: [README_START_HERE.md](README_START_HERE.md). Доступ по http://localhost:3100, изолированные Docker volumes, СБП отключён.
