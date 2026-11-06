# Безопасность и правовые предпосылки

**Этот файл — инженерный чеклист, не юридическое заключение.**

## Go / No-Go до реальных пользователей

- [ ] Письменное подтверждение WaveSpeed коммерческой модели: собственные AI Apps над API, платный доступ пользователей из РФ, право на выдачу сгенерированных файлов, ограничения провайдера.
- [ ] Проверка оплаты WaveSpeed: страна, валюта, организация, способ пополнения, договор и ограничения.
- [ ] Правовая форма бизнеса, договор ЮKassa, СБП, фискализация, чеки за аванс/зачёт и возвраты.
- [ ] Оценка обязанностей оператора персональных данных: локализация, согласия, публичная политика, передача фотографий/видео за рубеж, необходимые уведомления.
- [ ] Правила запрещённых материалов, согласие на использование изображений людей, механизм жалоб и удаления.
- [ ] Документы для клиента: оферта, правила сервиса, возвраты, политика конфиденциальности.

## Threat model

| Риск | Контроль |
|---|---|
| Утечка WaveSpeed или ЮKassa secrets | env/secret storage, server-only SDK, rotation, redacted logs |
| Подмена paid amount на клиенте | серверная quote с hash/expiry, immutable order total |
| Повтор payment webhook | lookup payment через API, unique payment id, transactional credit once |
| Двойной upstream POST | client key, worker lease, состояние unknown submission, reconciliation; НЕ blind retry |
| Отрицательный баланс / race | атомарный UPDATE с проверкой available, ledger, serializable/locks по необходимости |
| SSRF в ссылках медиа | allowlist hosts, ограниченный redirect, DNS/IP checks, size/time limits |
| Загрузка вредоносных файлов | MIME sniffing, размер, расширение, malware scan по риску |
| Доступ к чужим файлам | owner checks, private buckets, short TTL signed URLs |
| XSS/injection | server validation, output escaping, CSP, prepared SQL |
| DDoS и массовое расходование API | per-user/global rate limits, wallet pre-authorization, cost ceilings |
| Подмена webhook WaveSpeed | проверять Standard Webhooks signature, timestamp/replay |
| Неправильные результаты провайдера | сохранять provider id, event id, logs без лишних персональных данных |

## Среды

- local/demo: никакие секреты и расходы не нужны.
- test: отдельные ключи, только заранее разрешённые тестовые задачи и небольшие лимиты.
- production: разделённые ключи, резервное копирование, мониторинг бюджета, доступ к БД только внутренней сетью, HTTPS.

## Ретеншн

- Исходники и результаты пользователей приватны; сроки хранения заранее определены и отображены в политике.
- Результаты WaveSpeed доступны ограниченное время, поэтому копируются в контролируемое хранилище.
- Удаление медиа не должно нарушать требования к хранению обязательных финансовых документов.

## Ссылки для проверки

- https://wavespeed.ai/terms-of-service
- https://wavespeed.ai/docs/how-to-use-webhooks
- https://yookassa.ru/developers/using-api/webhooks
- https://www.consultant.ru/document/cons_doc_LAW_61801/
