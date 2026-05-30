# Telegram-бот рэферальнай праграмы

Telegram-бот, які прадае доступ на абмежаваны тэрмін да прыватнага канала з аплатай у **TRON USDT (TRC20)** і **двухузроўневай каскаднай** рэферальнай праграмай. Самакастадыяльны: для кожнага рахунку ствараецца асобны дэпазітны адрас, выведзены з HD-кашалька; сродкі змятаюцца на халодны кашалёк; рэферальныя камісіі выплачваюцца аўтаматычна з гарачага кашалька.

> [🇬🇧 English](./README.md) · [🇷🇺 Русский](./README_ru.md) · 🇧🇾 Беларуская

---

## Як гэта працуе

1. Карыстальнік запускае `/start` (па жаданні — з рэферальным кодам) і `/buy`. Бот стварае **рахунак** з унікальным дэпазітным адрасам TRC20, выведзеным з HD-кашалька (`m/44'/195'/0'/0/{index}`).
2. Cron-задача (`scan-payments`) апытвае TronGrid. Калі прыходзіць пацверджаны перавод USDT на суму ≥ суме рахунку, рахунак закрываецца, ствараецца **падпіска**, а карыстальніку дасылаецца аднаразовая спасылка-запрашэнне ў канал.
3. Пры закрыцці рахунку налічваюцца **рэферальныя камісіі**: прамы рэферэр (L1) атрымлівае працэнт паводле тарыфнай сеткі ад пакупкі; яго рэферэр (L2) атрымлівае працэнт ад камісіі L1.
4. Іншыя cron-задачы адказваюць за напаміны пра падаўжэнне і сканчэнне тэрміну (мяккае выдаленне з канала), аўтаматычныя **выплаты** даступных камісій і **змятанне** дэпазітаў на халодны кашалёк.

### Стэк тэхналогій

| Слой | Выбар |
|---|---|
| Фрэймворк | Next.js 16 (App Router) на Vercel |
| Мова | TypeScript |
| Бот | grammY (рэжым webhook) |
| БД | Postgres праз Drizzle ORM + serverless-драйвер Neon (`neon-http`, **без транзакцый**) |
| KV / блакіроўкі / ліміты | Upstash Redis (REST) |
| Блокчэйн | TRON — HD-дэрывацыя `@scure/bip32`, `tronweb` для зборкі транзакцый, TronGrid REST для чытання/трансляцыі |
| Грошы | `decimal.js`, усе сумы `numeric(18,6)` |
| Планавальнік | Vercel Cron |

Усе грашовыя аперацыі ідэмпатэнтныя (UNIQUE-абмежаванні + упарадкаваныя запісы), бо драйвер `neon-http` не падтрымлівае шматаператарныя транзакцыі.

---

## Папярэднія патрабаванні

- **Node.js 20+**
- База дадзеных **Postgres** — рэкамендуецца [Neon](https://neon.tech) (праграма выкарыстоўвае serverless-драйвер Neon).
- База **Upstash Redis** (REST API).
- Токен **Telegram-бота** ад [@BotFather](https://t.me/BotFather).
- **Прыватны Telegram-канал**, дзе бот з'яўляецца адміністратарам з правамі *запрашаць карыстальнікаў* і *баніць карыстальнікаў*.
- API-ключ **TronGrid** ([trongrid.io](https://www.trongrid.io)).
- Тры TRON-кашалькі:
  - **Дэпазітны xprv** — пашыраны прыватны ключ BIP32 для дэрывацыі дэпазітных адрасоў пад кожны рахунак.
  - **Гарачы кашалёк** — прыватны ключ у hex, папоўнены USDT (для выплат) + TRX (для аплаты газу пры змятанні).
  - **Халодны кашалёк** — толькі T-адрас; яго ключ ніколі не трапляе на сервер.

---

## Зменныя асяроддзя

Скапіруйце `.env.example` у `.env.local` і запоўніце. Сакрэты генеруйце праз `openssl rand -hex 32`.

| Зменная | Абавязковая | Апісанне |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Радок падлучэння да Postgres (Neon). |
| `CRON_SECRET` | ✅ | Bearer-сакрэт для аўтарызацыі cron-маршрутаў (мін. 16 сімвалаў). |
| `ADMIN_API_SECRET` | ➖ | Bearer-сакрэт для адмінскіх API-маршрутаў (мін. 16 сімвалаў). Пры адсутнасці выкарыстоўваецца `CRON_SECRET`. |
| `TELEGRAM_BOT_TOKEN` | ✅ | Токен бота ад @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | Сакрэтны токен, які Telegram вяртае пры кожным выкліку webhook (мін. 8 сімвалаў). |
| `DEFAULT_CHANNEL_ID` | ✅ | Лікавы ID канала (адмоўны, напр. `-100…`). |
| `TRON_DEPOSIT_XPRV` | ✅ | BIP32 xprv для дэрывацыі дэпазітных адрасоў. |
| `TRON_HOT_WALLET_PK` | ✅ | Прыватны ключ (hex) гарачага кашалька выплат. |
| `TRON_COLD_WALLET_ADDRESS` | ✅ | TRC20-адрас халоднага сховішча (прэфікс T, 34 сімвалы). |
| `TRONGRID_API_KEY` | ✅ | API-ключ TronGrid. |
| `UPSTASH_REDIS_REST_URL` | ✅ | REST URL Upstash Redis (https). |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | REST-токен Upstash Redis. |
| `ADMIN_TG_IDS` | ✅ | ID карыстальнікаў Telegram з адмін-доступам праз коску (можа быць пустым). |
| `MAX_PAYOUT_PER_TX_USDT` | ✅ | Засцерагальнік: жорсткі ліміт на адну выплату (напр. `1000`). |
| `MAX_PAYOUTS_PER_HOUR` | ✅ | Засцерагальнік: жорсткі ліміт на колькасць выплат у гадзіну (напр. `30`). |
| `LOG_LEVEL` | ➖ | Узровень лагіравання pino (па змаўчанні `info`). |
| `TRON_FAKE` | ➖ | Задайце `1`, каб выкарыстоўваць імітацыю блокчэйна ў памяці (лакальная распрацоўка / CI, без рэальнага доступу да TRON). |

---

## Лакальная распрацоўка

```bash
# 1. Усталяванне
nvm use            # або пераканайцеся, што Node 20+
npm install

# 2. Налада
cp .env.example .env.local
# адрэдагуйце .env.local — для афлайн-распрацоўкі задайце TRON_FAKE=1, каб не патрэбныя былі рэальныя ключы TRON

# 3. База дадзеных
npm run db:migrate     # прымяніць міграцыі
npm run db:seed        # засеяць тарыфы, канфіг камісій, kill switch

# 4. Тэсты (не патрэбныя ні БД, ні сетка — выкарыстоўваюцца фэйкі/мокі)
npm test

# 5. Сервер распрацоўкі
npm run dev            # http://localhost:3000
```

### Прыём абнаўленняў Telegram лакальна

Telegram патрэбны публічны HTTPS-URL для дастаўкі webhook. Пракіньце dev-сервер праз тунэль (напрыклад, [ngrok](https://ngrok.com)) і зарэгіструйце webhook:

```bash
ngrok http 3000
# затым, указаўшы DEPLOY_URL або URL тунэля аргументам:
npx tsx scripts/setup-telegram-webhook.ts https://<ваш-тунэль>.ngrok.app
```

Гэта ўкажа Telegram на `https://<url>/api/tg/webhook` і ўсталюе сакрэтны токен з `TELEGRAM_WEBHOOK_SECRET`.

### Ручны запуск cron-задач

Cron-маршруты — гэта звычайныя GET-эндпойнты з аўтарызацыяй:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scan-payments
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-access
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/payout-queue
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sweep
```

### Карысныя скрыпты

| Скрыпт | Прызначэнне |
|---|---|
| `npm test` | Запуск набору Vitest (145 тэстаў). |
| `npm run build` | Прадакшэн-зборка. |
| `npm run lint` | ESLint. |
| `npm run db:generate` | Згенераваць міграцыю Drizzle з `db/schema.ts`. |
| `npm run db:migrate` | Прымяніць міграцыі. |
| `npm run db:seed` | Засеяць даведачныя дадзеныя. |
| `npx tsx scripts/e2e-nile.ts` | Перадпалётная праверка: БД, KV, дэрывацыя TRON, канфіг. |
| `npx tsx scripts/setup-telegram-webhook.ts <url>` | Зарэгістраваць webhook Telegram. |

---

## Зборка

```bash
npm run build
```

Стварае аптымізаваную прадакшэн-зборку Next.js. API-маршруты рэндэрацца на серверы па запыце (`/api/*`); пасадачная старонка статычная.

---

## Разгортванне на Vercel

1. **Запушце** рэпазіторый у GitHub/GitLab і **імпартуйце** праект у Vercel.

2. **Задайце зменныя асяроддзя** ў *Project → Settings → Environment Variables* — усе абавязковыя зменныя з табліцы вышэй. Выкарыстоўвайце надзейны ўнікальны `CRON_SECRET` і асобны `ADMIN_API_SECRET`.

3. **Разгарніце.** Запішыце прадакшэн-URL (напр. `https://your-app.vercel.app`).

4. **Прымяніце міграцыі + сід** да прадакшэн-БД (з уласнай машыны, з прадакшэн-`DATABASE_URL` у асяроддзі абалонкі):
   ```bash
   npx tsx scripts/migrate.mts
   npx tsx scripts/seed.ts
   ```

5. **Зарэгіструйце webhook Telegram** на прадакшэн-URL:
   ```bash
   npx tsx scripts/setup-telegram-webhook.ts https://your-app.vercel.app
   ```

6. **Cron-задачы** вызначаны ў [`vercel.json`](./vercel.json) і падхопліваюцца аўтаматычна:

   | Шлях | Расклад |
   |---|---|
   | `/api/cron/scan-payments` | кожную 1 хв |
   | `/api/cron/expire-access` | кожную 1 хв |
   | `/api/cron/payout-queue` | кожныя 5 хв |
   | `/api/cron/sweep` | кожныя 10 хв |

   Vercel Cron аўтаматычна дасылае загаловак `Authorization: Bearer $CRON_SECRET`, таму маршруты абаронены. KV-ліз прадухіляе накладанне запускаў.

7. **Налада канала:** дадайце бота адміністратарам у прыватны канал з правамі *запрашаць карыстальнікаў* і *баніць карыстальнікаў* і пераканайцеся, што `DEFAULT_CHANNEL_ID` яму адпавядае.

8. **Папоўніце кашалькі:** гарачы — USDT (≥ некалькіх дзён чаканых камісій) + ≥ 100 TRX на газ для змятання; праверце адрас халоднага кашалька.

Глядзіце [`docs/runbook.md`](./docs/runbook.md) — поўны **смоук-тэст у тэстнэце Nile** і **чэк-ліст прадакшэн-выкату**. Не запускайцеся ў бой, не прайшоўшы смоук-тэст.

---

## Эксплуатацыя

- **Праверка здароўя:** `GET /api/health` вяртае колькасць рахункаў у чаканні і стан kill switch. Падключыце да яго маніторынг аптайму.
- **Адмін у Telegram:** карыстальнікі з `ADMIN_TG_IDS` могуць выкарыстоўваць `/admin` для актуальнай статыстыкі (аплачаныя рахункі, налічаныя камісіі, балансы гарачага кашалька, стан kill switch).
- **Аварыйныя выключальнікі** (адмін-API, `ADMIN_API_SECRET`):
  ```bash
  curl -X POST -H "Authorization: Bearer $ADMIN_API_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"buyDisabled":true,"reason":"maintenance"}' \
    https://your-app.vercel.app/api/admin/kill-switch
  ```
- **Канфіг камісій** можна змяняць на ляту праз `POST /api/admin/commission-config` (тарыфы, стаўка L2, рэжым выплат, мінімальная выплата).
- **Засцерагальнікі:** `MAX_PAYOUT_PER_TX_USDT` і `MAX_PAYOUTS_PER_HOUR` аўтаматычна адключаюць выплаты і апавяшчаюць адмінаў пры спрацоўванні.

---

## Структура праекта

```
app/api/
  cron/{scan-payments,expire-access,payout-queue,sweep}/  cron-эндпойнты Vercel
  admin/{kill-switch,commission-config}/                 адмінскія маршруты зменаў
  tg/webhook/                                            webhook Telegram
  health/                                                праверка здароўя
bot/
  bot.ts            бот grammY + падключэнне апрацоўшчыкаў
  handlers/         /start, /buy, /renew, /admin, дашборд, адрас выплат
  services/         анбордынг, рахункі, выдача доступу, дашборд, стан дыялогу
  middleware/       адмін-гейт
lib/
  tron/             HD-дэрывацыя, кліент TronGrid, фэйкавы блокчэйн для тэстаў
  settle.ts         закрыццё рахунку + падаўжэнне са стэкінгам
  commissions.ts    налічэнне двухузроўневых камісій
  payouts.ts        пакетныя выплаты камісій
  sweep.ts          змятанне дэпазітаў на халодны кашалёк
  expiry.ts         напаміны пра падаўжэнне + мяккае выдаленне пры сканчэнні
  money.ts          хелперы decimal.js з 6 знакамі
  kv.ts             агульны кліент Redis + cooldown
  cron-lease.ts     KV-ліз (compare-and-delete)
  cron-route.ts     агульная абгортка cron-маршруту (аўтарызацыя + ліз)
  api-auth.ts       хелперы bearer-аўтарызацыі
  breakers.ts       засцерагальнікі выплат
  env.ts            асяроддзе з валідацыяй zod
db/
  schema.ts         схема Drizzle
  migrations/       згенераваныя SQL-міграцыі
scripts/            міграцыі, сід, налада webhook, перадпалётная праверка
docs/               дызайн, план рэалізацыі, runbook
```

---

## Ліцэнзія

Прыватны / неапублікаваны праект.
