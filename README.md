# Telegram Referral Bot

A Telegram bot that sells time-limited access to a private channel, paid in **TRON USDT (TRC20)**, with a **2-level cascading referral** program. Self-custodial: each invoice gets its own HD-derived deposit address; funds are swept to a cold wallet; referral commissions are paid out automatically from a hot wallet.

> 🇬🇧 English · [🇷🇺 Русский](./README_ru.md) · [🇧🇾 Беларуская](./README_by.md)

---

## How it works

1. A user runs `/start` (optionally with a referral code) and `/buy`. The bot creates an **invoice** with a unique TRC20 deposit address derived from an HD wallet (`m/44'/195'/0'/0/{index}`).
2. A cron job (`scan-payments`) polls TronGrid. When a confirming USDT transfer ≥ the invoice amount arrives, the invoice is settled, a **subscription** is created, and the user is sent a one-time channel invite link.
3. Settlement accrues **referral commissions**: the direct referrer (L1) earns a tiered percentage of the purchase; their referrer (L2) earns a percentage of the L1 commission.
4. Other cron jobs handle renewal nudges + expiry (soft-kick from the channel), automatic **payouts** of payable commissions, and **sweeping** deposits to the cold wallet.

### Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) on Vercel |
| Language | TypeScript |
| Bot | grammY (webhook mode) |
| DB | Postgres via Drizzle ORM + Neon serverless driver (`neon-http`, **no transactions**) |
| KV / locks / rate limits | Upstash Redis (REST) |
| Chain | TRON — `@scure/bip32` HD derivation, `tronweb` for tx building, TronGrid REST for reads/broadcast |
| Money | `decimal.js`, all amounts `numeric(18,6)` |
| Scheduling | Vercel Cron |

All money-moving flows are idempotent (UNIQUE constraints + ordered writes) since the `neon-http` driver has no multi-statement transactions.

---

## Prerequisites

- **Node.js 20+**
- A **Postgres** database — [Neon](https://neon.tech) recommended (the app uses the Neon serverless driver).
- An **Upstash Redis** database (REST API).
- A **Telegram bot** token from [@BotFather](https://t.me/BotFather).
- A **private Telegram channel** where the bot is an admin with *invite users* and *ban users* rights.
- A **TronGrid** API key ([trongrid.io](https://www.trongrid.io)).
- Three TRON wallets:
  - **Deposit xprv** — BIP32 extended private key used to derive per-invoice deposit addresses.
  - **Hot wallet** — hex private key, funded with USDT (for payouts) + TRX (for sweep gas top-ups).
  - **Cold wallet** — a T-address only; its key never touches the server.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. Generate secrets with `openssl rand -hex 32`.

| Variable | Required | Description |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Postgres connection string (Neon). |
| `CRON_SECRET` | ✅ | Bearer secret for cron route auth (min 16 chars). |
| `ADMIN_API_SECRET` | ➖ | Bearer secret for admin API routes (min 16 chars). Falls back to `CRON_SECRET` if unset. |
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | Secret token Telegram echoes on each webhook call (min 8 chars). |
| `DEFAULT_CHANNEL_ID` | ✅ | Numeric channel ID (negative, e.g. `-100…`). |
| `TRON_DEPOSIT_XPRV` | ✅ | BIP32 xprv for deposit-address derivation. |
| `TRON_HOT_WALLET_PK` | ✅ | Hex private key of the hot (payout) wallet. |
| `TRON_COLD_WALLET_ADDRESS` | ✅ | Cold treasury TRC20 address (T-prefix, 34 chars). |
| `TRONGRID_API_KEY` | ✅ | TronGrid API key. |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST URL (https). |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis REST token. |
| `ADMIN_TG_IDS` | ✅ | Comma-separated Telegram user IDs with admin access (may be empty). |
| `MAX_PAYOUT_PER_TX_USDT` | ✅ | Circuit breaker: hard cap on a single payout tx (e.g. `1000`). |
| `MAX_PAYOUTS_PER_HOUR` | ✅ | Circuit breaker: hard cap on payout tx per hour (e.g. `30`). |
| `LOG_LEVEL` | ➖ | pino log level (default `info`). |
| `TRON_FAKE` | ➖ | Set to `1` to use an in-memory fake chain (local dev / CI, no real TRON access). |

---

## Local development

```bash
# 1. Install
nvm use            # or ensure Node 20+
npm install

# 2. Configure
cp .env.example .env.local
# edit .env.local — for offline dev set TRON_FAKE=1 to skip real TRON keys

# 3. Database
npm run db:migrate     # apply migrations
npm run db:seed        # seed plans, commission config, kill switch

# 4. Tests (no DB or network required — uses fakes/mocks)
npm test

# 5. Dev server
npm run dev            # http://localhost:3000
```

### Receiving Telegram updates locally

Telegram needs a public HTTPS URL to deliver webhooks. Tunnel your dev server (e.g. with [ngrok](https://ngrok.com)) and register the webhook:

```bash
ngrok http 3000
# then, with DEPLOY_URL or the tunnel URL as the argument:
npx tsx scripts/setup-telegram-webhook.ts https://<your-tunnel>.ngrok.app
```

This points Telegram at `https://<url>/api/tg/webhook` and sets the secret token from `TELEGRAM_WEBHOOK_SECRET`.

### Triggering cron jobs manually

The cron routes are plain authenticated GET endpoints:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scan-payments
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-access
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/payout-queue
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sweep
```

### Useful scripts

| Script | Purpose |
|---|---|
| `npm test` | Run the Vitest suite (145 tests). |
| `npm run build` | Production build. |
| `npm run lint` | ESLint. |
| `npm run db:generate` | Generate a Drizzle migration from `db/schema.ts`. |
| `npm run db:migrate` | Apply migrations. |
| `npm run db:seed` | Seed reference data. |
| `npx tsx scripts/e2e-nile.ts` | Pre-flight check: DB, KV, TRON derivation, config. |
| `npx tsx scripts/setup-telegram-webhook.ts <url>` | Register the Telegram webhook. |

---

## Build

```bash
npm run build
```

Produces an optimized Next.js production build. The API routes are server-rendered on demand (`/api/*`); the landing page is static.

---

## Deploy to Vercel

1. **Push** the repo to GitHub/GitLab and **import** the project into Vercel.

2. **Set environment variables** in *Project → Settings → Environment Variables* — every required variable from the table above. Use a strong unique `CRON_SECRET` and a separate `ADMIN_API_SECRET`.

3. **Deploy.** Note the production URL (e.g. `https://your-app.vercel.app`).

4. **Run migrations + seed** against the production DB (from your machine, with the production `DATABASE_URL` in your shell):
   ```bash
   npx tsx scripts/migrate.mts
   npx tsx scripts/seed.ts
   ```

5. **Register the Telegram webhook** at the production URL:
   ```bash
   npx tsx scripts/setup-telegram-webhook.ts https://your-app.vercel.app
   ```

6. **Cron jobs** are defined in [`vercel.json`](./vercel.json) and picked up automatically:

   | Path | Schedule |
   |---|---|
   | `/api/cron/scan-payments` | every 1 min |
   | `/api/cron/expire-access` | every 1 min |
   | `/api/cron/payout-queue` | every 5 min |
   | `/api/cron/sweep` | every 10 min |

   Vercel Cron automatically sends the `Authorization: Bearer $CRON_SECRET` header, so the routes are protected. A KV lease prevents overlapping runs.

7. **Channel setup:** add the bot as an admin to your private channel with *invite users* and *ban users* permissions, and confirm `DEFAULT_CHANNEL_ID` matches it.

8. **Fund the wallets:** hot wallet with USDT (≥ a couple of days of expected commissions) + ≥ 100 TRX for sweep gas; verify the cold wallet address.

See [`docs/runbook.md`](./docs/runbook.md) for the full **Nile testnet smoke test** and the **production rollout checklist** — do not go live without running the smoke test.

---

## Operations

- **Health check:** `GET /api/health` returns pending-invoice count and kill-switch state. Point an uptime monitor at it.
- **Admin in Telegram:** users in `ADMIN_TG_IDS` can use `/admin` for live stats (paid invoices, accrued commissions, hot-wallet balances, kill-switch state).
- **Kill switches** (admin API, `ADMIN_API_SECRET`):
  ```bash
  curl -X POST -H "Authorization: Bearer $ADMIN_API_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"buyDisabled":true,"reason":"maintenance"}' \
    https://your-app.vercel.app/api/admin/kill-switch
  ```
- **Commission config** can be updated live via `POST /api/admin/commission-config` (tiers, L2 rate, payout mode, min payout).
- **Circuit breakers:** `MAX_PAYOUT_PER_TX_USDT` and `MAX_PAYOUTS_PER_HOUR` auto-disable payouts and alert admins if tripped.

---

## Project structure

```
app/api/
  cron/{scan-payments,expire-access,payout-queue,sweep}/  Vercel cron endpoints
  admin/{kill-switch,commission-config}/                 admin mutation routes
  tg/webhook/                                            Telegram webhook
  health/                                                health probe
bot/
  bot.ts            grammY bot + handler wiring
  handlers/         /start, /buy, /renew, /admin, dashboard, payout address
  services/         onboarding, invoices, grant, dashboard, conv-state
  middleware/       admin gate
lib/
  tron/             HD derivation, TronGrid client, fake chain for tests
  settle.ts         invoice settlement + stacking renewal
  commissions.ts    2-level commission accrual
  payouts.ts        batched commission payouts
  sweep.ts          deposit → cold wallet sweeping
  expiry.ts         renewal nudges + soft-kick on expiry
  money.ts          decimal.js 6dp helpers
  kv.ts             shared Redis client + cooldown
  cron-lease.ts     KV lease (compare-and-delete)
  cron-route.ts     shared cron route wrapper (auth + lease)
  api-auth.ts       bearer auth helpers
  breakers.ts       payout circuit breakers
  env.ts            zod-validated environment
db/
  schema.ts         Drizzle schema
  migrations/       generated SQL migrations
scripts/            migrate, seed, webhook setup, e2e pre-flight
docs/               design, implementation plan, runbook
```

---

## License

Private / unpublished.
