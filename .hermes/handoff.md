# Handoff: Telegram Referral Bot (@WhaleReferral_bot)

## Контакты
- **Владелец:** Александр (@Almarts, TG ID: 607645943)
- **Бот:** @WhaleReferral_bot (ID: 8805267560)
- **Канал:** @whaledcapro
- **Деплой:** Vercel — `telegram-referral-bot-gules.vercel.app`
- **Репозиторий:** github.com/Almarts/telegram-referral-bot (ветка `main`)
- **БД:** Railway PostgreSQL — `zephyr.proxy.rlwy.net:23235/railway`

## Ключи и доступы (СКОПИРОВАТЬ ПЕРЕД ПЕРЕДАЧЕЙ!)

### Файлы конфигурации
Все данные в файлах на ПК Александра:
- `C:\Users\marts\projects\telegram-referral-bot-main\.env.local` — текущие ключи
- `C:\Users\marts\projects\telegram-referral-bot-main\.env` — старая конфигурация (другая!)
- `C:\Users\marts\projects\telegram-referral-bot-main\.env.production` — что на Vercel production
- `C:\Users\marts\projects\telegram-referral-bot-main\.env.vercel` — Vercel project env

### Vercel
- **Проект:** telegram-referral-bot
- **Токен:** (в .env.vercel)
- **CRON_SECRET (Vercel):** (в .env.local)
- **CRON_SECRET (локальный):** (в .env.local)

### Telegram
- **Токен:** `8805267560:AAEg4Bz7axTzWHQ8jAFSGRfqWs5yJ0J5YAc`
- **Webhook Secret:** `554837c9-c0e2-4a12-80d5-28e7fc310ae3`

### TRON Кошельки

| Роль | Адрес | Приватный ключ | Баланс |
|------|-------|---------------|--------|
| **HOT (текущий)** | `TMc4zof2CJkv4G3LV8CmifjtK5ZmvbdB9P` | (в .env.local) | 0.73 TRX, 0 USDT |
| **HOT (оригинальный)** | `TEe1CKsUrNbdZjBMZeB3LLBqhNvzgNkfZK` | (в .env.local) | пустой |
| **COLD (новый)** | `TXKx4zMsfDt11Mfgb2wZSuQDpobuqJj3nC` | (в .env.local) | 1 USDT |
| **COLD (старый, ключ потерян)** | `TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW` | НЕ СОХРАНИЛСЯ | 0 |
| **XPRV мастер-ключ** | используется для генерации депозитных адресов | (в .env.local) | — |

### Пользователь
- **Payout адрес Александра:** `TYKkPVu1ccsBKy1uvWh2MRJavAwXLE3kMY`
- **Роль:** VIP Creator (50% комиссии, vipBps=5000)
- **Рефкод:** EW0B4C

## МОИ ОШИБКИ (что потеряно)

1. **27.64 TRX** — показал не тот адрес для пополнения, ключ потерян (`THy8D8Ff7CxQWg9aYYg235waLqzQz3TRrp`)
2. **9.97 USDT + ~22 TRX** — ghost-транзакция при тесте sweep, ушли на `TXka2VZnehG9gUwkdCfcXU9XhcwTAPYiXj` (ключа нет)
3. **18 TRX** — отправил на wrong deposit `TN8sYb6UPt5M4zAJo94Q5sCn8HhYCq7pYp` (не наш ключ)
4. **~15.5 TRX** — ушли на `TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu` (не наш адрес)
5. **feeLimit менял** — с 100 TRX до 300k, потом обратно до 18 TRX (сжёг лишние TRX на тестах)

## Текущее состояние

### Бот
- ✅ Работает, принимает платежи
- ✅ Создаёт инвойсы, выдаёт доступ
- ✅ Комиссии начисляются (accrued)
- ⛔ SWEEP не работает (нет TRX)
- ⛔ Выплаты (payout-queue) не идут (нет TRX, safety-rail блокирует)

### Комиссии в БД
- **3.497 USDT** — accrued/payable для Александра (ID 607645943)
- Есть другие пользователи с комиссиями (суммы неизвестны — смотреть в БД)

### Cron (GitHub Actions)
- `scan-payments` — каждые 5 мин ✅ работает
- `sweep` — каждые 5 мин ❌ нет TRX
- `payout-queue` — каждые 30 мин ❌ safety-rail
- `expire-access` — каждые 60 мин ✅

## Что нужно сделать новому ИИ

1. **Проверить БД** — сколько всего USDT в комиссиях (SELECT SUM(amount_usdt) FROM commission_ledger WHERE status IN ('accrued','payable'))
2. **Пополнить TRX** на hot wallet `TMc4zof2...` (нужно минимум 18 TRX для fee)
3. **Исправить sweep** — через TronWeb broadcasttransaction
4. **Сделать выплату** Александру 3.497 USDT на `TYKkPVu...`
5. **Убрать whitelist** в safety-rail.ts (временно добавлен адрес `TYKkPVu...`)

## Ключевые файлы

| Файл | Назначение |
|------|-----------|
| `lib/tron/real.ts` | TRON интеграция (sendUsdt, balance check) |
| `lib/tron/safety-rail.ts` | **ВАЖНО** — блокирует все USDT не на cold wallet |
| `lib/tron/sweep.ts` | Sweep с депозитов на cold |
| `lib/payouts.ts` | Выплата комиссий (approval gate disabled) |
| `lib/payout-approval.ts` | In-memory approval queue |
| `lib/commissions.ts` | Расчёт комиссий |
| `bot/bot.ts` | Команды, middleware |
| `bot/handlers/start.ts` | Онбординг |
| `bot/handlers/withdraw_now.ts` | Вывод |
| `bot/handlers/payout_address.ts` | Установка адреса выплат |

## Предупреждения

### ⚠️ feeLimit: 18_000_000 — НИКОГДА НЕ МЕНЯТЬ
В коде runtime guard. Нарушение = потеря TRX.

### ⚠️ safety-rail.ts — НЕ ОТКЛЮЧАТЬ
Блокирует все USDT sends не на cold wallet. Временно добавлен whitelist адреса `TYKkPVu...`.

### ⚠️ MSYS на Windows
Терминал на этом ПК (git-bash) ломает строки с `-` и спецсимволами. CRON_SECRET, Vercel token **нельзя передавать в inline URL**. Использовать `source .env.local` и переменные.

### ⚠️ Python на Windows
`python3` не установлен, `python` — 3.11.15, `pip` ведёт на python3.14. Использовать `uv`.

### ⚠️ Vercel deploy
CLI 54.x не принимает `vcp_` токены. Деплой через git push → GitHub Actions или через Vercel REST API.
