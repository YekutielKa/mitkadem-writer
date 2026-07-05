# CLAUDE.md — mitkadem-writer

> Автосгенерировано нарядом SPRINT_ARCHITECT_KIT (Обн-213, 05.07.2026). Источник правил: канон `mitkadem-system_docs`: architect_kit/ (учебник), CONTEXT_CAPSULE.md (живая капсула), 00_SYSTEM_DOCS/trace_20260705/ (полная трасса). При противоречии — прав канон.

## Что это
Генератор текста поста (WriteTask: caption+image_prompt, hashtag-guardrails, grounded arms). LLM — через llm-hub.
Место в системе: `architect_kit/06_SYSTEM_MAP.md`; глава трассы про этот сервис: `trace_20260705/SYSTEM_TRACE_ETALON.md` — гл. 6.3.

## Перед любой работой
1. Прочитай `mitkadem-system_docs/CONTEXT_CAPSULE.md` («где мы сейчас», hold'ы, keep-лист тенантов).
2. Прочитай `architect_kit/07_GRABLI.md` (симптом → причина → правило) — многие инциденты уже случались.
3. Один наряд за раз; найденное по пути НЕ чинить «заодно» — списком в отчёт.

## Деплой (Railway)
«Задеплоено» = LOCKED #42, три доказательства ВМЕСТЕ:
1. Активный деплой SUCCESS (`railway deployment list`, верхняя строка; FAILED НЕ снимает старую сборку — `/health` 200 врёт).
2. Активный деплой несёт коммит наряда (`meta.commitHash`; после `railway up` — retrigger пушем или фиксация «чистое дерево + HEAD»).
3. Живая прод-проба самой фичи (не смоук).

## БД / пулы
- Общая Railway-Postgres, изоляция схемами; рантайм ТОЛЬКО через PgBouncer `hayabusa…:24416` под ролью `mitkadem_app` (под `postgres` — никогда).
- `DIRECT_URL` = литеральный прямой switchback-URL — ТОЛЬКО миграции и session-локи (не пулер, не Railway-reference!).
- Advisory-lock Prisma **72707369 общий на ВСЮ БД**: не деплоить одновременно с другими Prisma-сервисами; упавший по P1002 — передеплоить после.

## Секреты (ИМЕНА; значения только в Railway Variables; полная карта — KEY_REGISTRY.md)
`SERVICE_JWT_SECRET`, `LLM_HUB_URL`; self-DDL на буте (`tenant_hook_history`) — mitkadem_app обязан владеть public-объектами.
Парные секреты ротируются синхронно на обеих сторонах; при 401 между сервисами — sha256-сверка значений (класс граблей SERVICE_TOKEN/SERVICE_SECRET).

## ЗАПРЕЩЕНО в этом репо
- Язык контента = язык рынка (`CONTENT_MARKET_LANGUAGE_V2`) — не хардкодить.
- Секреты в код/логи/коммиты (только имена env — `KEY_REGISTRY.md`); попал в git = ротация.
- `AUTH_BYPASS` и любые выключатели auth (класс C22).
- Прямой postgres-URL литералом/в рантайм-env вне `DIRECT_URL`.
- Чинить «заодно» вне ГРАНИЦ наряда — найденное списком «наряды-кандидаты» в отчёт.

## Ссылки
Учебник: `mitkadem-system_docs/architect_kit/` (INDEX → 03_PATTERNS, 05_SECURITY, 07_GRABLI) · Капсула: `mitkadem-system_docs/CONTEXT_CAPSULE.md` · Трасса: `mitkadem-system_docs/00_SYSTEM_DOCS/trace_20260705/` · Секреты: `mitkadem-system_docs/KEY_REGISTRY.md`.
