# Развёртывание MVP на одном сервере

## Состав
- `web` — Next.js: каталог, кабинет и API.
- `worker` — обработка очереди генераций; предполагается ровно один worker.
- `db` — PostgreSQL 17, данные в volume `pgdata`.
- `migrate` — одноразовое применение миграций.
- `media` — Docker volume с приватными входами и результатами.

## Команды
```bash
git clone https://github.com/zlw0x/ai_content_maker.git
cd ai_content_maker
cp .env.example .env
# Установите отдельный непустой пароль POSTGRES_PASSWORD.
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 web worker
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
```

По умолчанию порт 3000 доступен только с самого VPS. Для тестов с рабочей станции:
```bash
ssh -L 3000:127.0.0.1:3000 user@your-vps
```
Открыть `http://localhost:3000`. Для постоянного домена настройте HTTPS proxy и корректное `APP_ORIGIN` (в точности как origin браузера).

## Демо-тест без API-ключей
В `.env`:
```
WAVESPEED_MODE=mock
PAYMENT_MODE=disabled
ALLOW_LIVE_PAYMENTS=false
DEMO_CREDIT_ENABLED=true
```
Зарегистрируйтесь через /account, получите разовый тестовый баланс в /dashboard, создайте и скачайте mock-файл в одном из приложений.

Не включайте `DEMO_CREDIT_ENABLED` в подключённой к реальному провайдеру или платёжным операциям среде. Не переносите пользовательские тестовые балансы в рабочую базу.

## Контроль качества
```bash
npm ci
npm run typecheck
npm run test:unit
npm run build
```
В GitHub Actions дополнительно запускаются миграции, REST smoke, Docker Compose config и браузерные Playwright tests.

## Live integraton только на staging
1. Отдельный **чистый** экземпляр БД без dev-платежей, средства/ключи минимально возможные, `DEMO_CREDIT_ENABLED=false`.
2. `WAVESPEED_MODE=live`, `WAVESPEED_API_KEY`, при webhook `WAVESPEED_CALLBACK_URL` и `WAVESPEED_WEBHOOK_SECRET`.
3. `OUTPUT_HOST_ALLOWLIST` — точные hostname CDN для проверенных URL провайдера, через запятую. Без него скачивание upstream результатов преднамеренно блокируется.
4. Настройте защиту reverse proxy: HTTPS, request body size, rate limits, журналы без токенов.
5. Реальные платежи ЮKassa в дефолтном релизе не разрешены. Проверка эквайринга, возвратов и фискализации — отдельный этап.
6. Обязательно испытать резервное копирование и восстановление pgdata + media volume.

## Ограничения
- Локальное storage и один worker: нельзя масштабировать горизонтально без общего object storage и согласованного лимита конкурентности.
- При неизвестном результате платного upstream POST задание получает статус `unknown`. Нельзя повторно отправлять его без проверки истории провайдера.
- Ошибки сохранения результата не должны списывать резерв; worker повторяет безопасный GET/скачивание.
- Не реализованы подтверждение email, password reset, полноценный admin support, отчётность и фискализация.
- Миграции сохраняют данные, но любая новая версия должна сначала проходить staging.

Дополнительная информация: [Backend](BACKEND.md), [Review](MVP_REVIEW.md), [Security](SECURITY_COMPLIANCE.md).


## Personal media and real upstream staging

Media outputs now expire after `OUTPUT_RETENTION_DAYS=30`; uploaded references still expire after 7 days. Users browse private results via `/library`, which never sends upstream WaveSpeed URLs. Details and safe staging credit procedure: [LIVE_STAGING_CHECKLIST.md](LIVE_STAGING_CHECKLIST.md).
