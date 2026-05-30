# Telegram-бот реферальной программы

Telegram-бот, который продаёт доступ на ограниченный срок к приватному каналу с оплатой в **TRON USDT (TRC20)** и **двухуровневой каскадной** реферальной программой. Несамокастодиальных посредников нет: для каждого счёта создаётся отдельный депозитный адрес, выведенный из HD-кошелька; средства сметаются на холодный кошелёк; реферальные комиссии выплачиваются автоматически с горячего кошелька.

> [🇬🇧 English](./README.md) · 🇷🇺 Русский · [🇧🇾 Беларуская](./README_by.md)

---

## Как это работает

1. Пользователь запускает `/start` (по желанию — с реферальным кодом) и `/buy`. Бот создаёт **счёт** с уникальным депозитным адресом TRC20, выведенным из HD-кошелька (`m/44'/195'/0'/0/{index}`).
2. Cron-задача (`scan-payments`) опрашивает TronGrid. Когда приходит подтверждённый перевод USDT на сумму ≥ суммы счёта, счёт закрывается, создаётся **подписка**, а пользователю отправляется одноразовая ссылка-приглашение в канал.
3. При закрытии счёта начисляются **реферальные комиссии**: прямой реферер (L1) получает процент по тарифной сетке от покупки; его реферер (L2) получает процент от комиссии L1.
4. Другие cron-задачи отвечают за напоминания о продлении и истечение срока (мягкое удаление из канала), автоматические **выплаты** доступных комиссий и **смётывание** депозитов на холодный кошелёк.

### Стек технологий

| Слой | Выбор |
|---|---|
| Фреймворк | Next.js 16 (App Router) на Vercel |
| Язык | TypeScript |
| Бот | grammY (режим webhook) |
| БД | Postgres через Drizzle ORM + serverless-драйвер Neon (`neon-http`, **без транзакций**) |
| KV / блокировки / лимиты | Upstash Redis (REST) |
| Блокчейн | TRON — HD-деривация `@scure/bip32`, `tronweb` для сборки транзакций, TronGrid REST для чтения/трансляции |
| Деньги | `decimal.js`, все суммы `numeric(18,6)` |
| Планировщик | Vercel Cron |

Все денежные операции идемпотентны (UNIQUE-ограничения + упорядоченные записи), поскольку драйвер `neon-http` не поддерживает многооператорные транзакции.

---

## Предварительные требования

- **Node.js 20+**
- База данных **Postgres** — рекомендуется [Neon](https://neon.tech) (приложение использует serverless-драйвер Neon).
- База **Upstash Redis** (REST API).
- Токен **Telegram-бота** от [@BotFather](https://t.me/BotFather).
- **Приватный Telegram-канал**, где бот является администратором с правами *приглашать пользователей* и *банить пользователей*.
- API-ключ **TronGrid** ([trongrid.io](https://www.trongrid.io)).
- Три TRON-кошелька:
  - **Депозитный xprv** — расширенный приватный ключ BIP32 для деривации депозитных адресов под каждый счёт.
  - **Горячий кошелёк** — приватный ключ в hex, пополненный USDT (для выплат) + TRX (для оплаты газа при смётывании).
  - **Холодный кошелёк** — только T-адрес; его ключ никогда не попадает на сервер.

---

## Переменные окружения

Скопируйте `.env.example` в `.env.local` и заполните. Секреты генерируйте через `openssl rand -hex 32`.

| Переменная | Обязательна | Описание |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Строка подключения к Postgres (Neon). |
| `CRON_SECRET` | ✅ | Bearer-секрет для авторизации cron-маршрутов (мин. 16 символов). |
| `ADMIN_API_SECRET` | ➖ | Bearer-секрет для админских API-маршрутов (мин. 16 символов). При отсутствии используется `CRON_SECRET`. |
| `TELEGRAM_BOT_TOKEN` | ✅ | Токен бота от @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | Секретный токен, который Telegram возвращает при каждом вызове webhook (мин. 8 символов). |
| `DEFAULT_CHANNEL_ID` | ✅ | Числовой ID канала (отрицательный, напр. `-100…`). |
| `TRON_DEPOSIT_XPRV` | ✅ | BIP32 xprv для деривации депозитных адресов. |
| `TRON_HOT_WALLET_PK` | ✅ | Приватный ключ (hex) горячего кошелька выплат. |
| `TRON_COLD_WALLET_ADDRESS` | ✅ | TRC20-адрес холодного хранилища (префикс T, 34 символа). |
| `TRONGRID_API_KEY` | ✅ | API-ключ TronGrid. |
| `UPSTASH_REDIS_REST_URL` | ✅ | REST URL Upstash Redis (https). |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | REST-токен Upstash Redis. |
| `ADMIN_TG_IDS` | ✅ | ID пользователей Telegram с админ-доступом через запятую (может быть пустым). |
| `MAX_PAYOUT_PER_TX_USDT` | ✅ | Предохранитель: жёсткий лимит на одну выплату (напр. `1000`). |
| `MAX_PAYOUTS_PER_HOUR` | ✅ | Предохранитель: жёсткий лимит на число выплат в час (напр. `30`). |
| `LOG_LEVEL` | ➖ | Уровень логирования pino (по умолчанию `info`). |
| `TRON_FAKE` | ➖ | Установите `1`, чтобы использовать имитацию блокчейна в памяти (локальная разработка / CI, без реального доступа к TRON). |

---

## Локальная разработка

```bash
# 1. Установка
nvm use            # или убедитесь, что Node 20+
npm install

# 2. Настройка
cp .env.example .env.local
# отредактируйте .env.local — для офлайн-разработки задайте TRON_FAKE=1, чтобы не нужны были реальные ключи TRON

# 3. База данных
npm run db:migrate     # применить миграции
npm run db:seed        # засеять тарифы, конфиг комиссий, kill switch

# 4. Тесты (не нужны ни БД, ни сеть — используются фейки/моки)
npm test

# 5. Сервер разработки
npm run dev            # http://localhost:3000
```

### Приём обновлений Telegram локально

Telegram нужен публичный HTTPS-URL для доставки webhook. Пробросьте dev-сервер через туннель (например, [ngrok](https://ngrok.com)) и зарегистрируйте webhook:

```bash
ngrok http 3000
# затем, указав DEPLOY_URL или URL туннеля аргументом:
npx tsx scripts/setup-telegram-webhook.ts https://<ваш-туннель>.ngrok.app
```

Это укажет Telegram на `https://<url>/api/tg/webhook` и установит секретный токен из `TELEGRAM_WEBHOOK_SECRET`.

### Ручной запуск cron-задач

Cron-маршруты — это обычные GET-эндпоинты с авторизацией:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scan-payments
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-access
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/payout-queue
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sweep
```

### Полезные скрипты

| Скрипт | Назначение |
|---|---|
| `npm test` | Запуск набора Vitest (145 тестов). |
| `npm run build` | Продакшен-сборка. |
| `npm run lint` | ESLint. |
| `npm run db:generate` | Сгенерировать миграцию Drizzle из `db/schema.ts`. |
| `npm run db:migrate` | Применить миграции. |
| `npm run db:seed` | Засеять справочные данные. |
| `npx tsx scripts/e2e-nile.ts` | Предполётная проверка: БД, KV, деривация TRON, конфиг. |
| `npx tsx scripts/setup-telegram-webhook.ts <url>` | Зарегистрировать webhook Telegram. |

---

## Сборка

```bash
npm run build
```

Создаёт оптимизированную продакшен-сборку Next.js. API-маршруты рендерятся на сервере по запросу (`/api/*`); посадочная страница статическая.

---

## Развёртывание на Vercel

1. **Запушьте** репозиторий в GitHub/GitLab и **импортируйте** проект в Vercel.

2. **Задайте переменные окружения** в *Project → Settings → Environment Variables* — все обязательные переменные из таблицы выше. Используйте надёжный уникальный `CRON_SECRET` и отдельный `ADMIN_API_SECRET`.

3. **Разверните.** Запишите продакшен-URL (напр. `https://your-app.vercel.app`).

4. **Примените миграции + сид** к продакшен-БД (со своей машины, с продакшен-`DATABASE_URL` в окружении оболочки):
   ```bash
   npx tsx scripts/migrate.mts
   npx tsx scripts/seed.ts
   ```

5. **Зарегистрируйте webhook Telegram** на продакшен-URL:
   ```bash
   npx tsx scripts/setup-telegram-webhook.ts https://your-app.vercel.app
   ```

6. **Cron-задачи** определены в [`vercel.json`](./vercel.json) и подхватываются автоматически:

   | Путь | Расписание |
   |---|---|
   | `/api/cron/scan-payments` | каждую 1 мин |
   | `/api/cron/expire-access` | каждую 1 мин |
   | `/api/cron/payout-queue` | каждые 5 мин |
   | `/api/cron/sweep` | каждые 10 мин |

   Vercel Cron автоматически отправляет заголовок `Authorization: Bearer $CRON_SECRET`, поэтому маршруты защищены. KV-лиз предотвращает наложение запусков.

7. **Настройка канала:** добавьте бота администратором в приватный канал с правами *приглашать пользователей* и *банить пользователей* и убедитесь, что `DEFAULT_CHANNEL_ID` ему соответствует.

8. **Пополните кошельки:** горячий — USDT (≥ нескольких дней ожидаемых комиссий) + ≥ 100 TRX на газ для смётывания; проверьте адрес холодного кошелька.

См. [`docs/runbook.md`](./docs/runbook.md) — полный **смоук-тест в тестнете Nile** и **чек-лист продакшен-выката**. Не запускайтесь в бой, не пройдя смоук-тест.

---

## Эксплуатация

- **Проверка здоровья:** `GET /api/health` возвращает число ожидающих счетов и состояние kill switch. Подключите к нему мониторинг аптайма.
- **Админ в Telegram:** пользователи из `ADMIN_TG_IDS` могут использовать `/admin` для актуальной статистики (оплаченные счета, начисленные комиссии, балансы горячего кошелька, состояние kill switch).
- **Аварийные выключатели** (админ-API, `ADMIN_API_SECRET`):
  ```bash
  curl -X POST -H "Authorization: Bearer $ADMIN_API_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"buyDisabled":true,"reason":"maintenance"}' \
    https://your-app.vercel.app/api/admin/kill-switch
  ```
- **Конфиг комиссий** можно менять на лету через `POST /api/admin/commission-config` (тарифы, ставка L2, режим выплат, минимальная выплата).
- **Предохранители:** `MAX_PAYOUT_PER_TX_USDT` и `MAX_PAYOUTS_PER_HOUR` автоматически отключают выплаты и оповещают админов при срабатывании.

---

## Структура проекта

```
app/api/
  cron/{scan-payments,expire-access,payout-queue,sweep}/  cron-эндпоинты Vercel
  admin/{kill-switch,commission-config}/                 админские маршруты изменений
  tg/webhook/                                            webhook Telegram
  health/                                                проверка здоровья
bot/
  bot.ts            бот grammY + подключение обработчиков
  handlers/         /start, /buy, /renew, /admin, дашборд, адрес выплат
  services/         онбординг, счета, выдача доступа, дашборд, состояние диалога
  middleware/       админ-гейт
lib/
  tron/             HD-деривация, клиент TronGrid, фейковый блокчейн для тестов
  settle.ts         закрытие счёта + продление со стекингом
  commissions.ts    начисление двухуровневых комиссий
  payouts.ts        пакетные выплаты комиссий
  sweep.ts          смётывание депозитов на холодный кошелёк
  expiry.ts         напоминания о продлении + мягкое удаление при истечении
  money.ts          хелперы decimal.js с 6 знаками
  kv.ts             общий клиент Redis + cooldown
  cron-lease.ts     KV-лиз (compare-and-delete)
  cron-route.ts     общая обёртка cron-маршрута (авторизация + лиз)
  api-auth.ts       хелперы bearer-авторизации
  breakers.ts       предохранители выплат
  env.ts            окружение с валидацией zod
db/
  schema.ts         схема Drizzle
  migrations/       сгенерированные SQL-миграции
scripts/            миграции, сид, настройка webhook, предполётная проверка
docs/               дизайн, план реализации, runbook
```

---

## Лицензия

Приватный / неопубликованный проект.
