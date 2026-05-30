# Runbook

> 🇬🇧 English · [🇷🇺 Русский](./runbook_ru.md) · [🇧🇾 Беларуская](./runbook_by.md)

## Nile testnet smoke test

Purpose: prove the full flow works end-to-end before going to mainnet.

### Prerequisites

- [ ] Nile testnet DB provisioned (Neon or local postgres)
- [ ] Nile testnet TRON accounts:
  - Deposit xprv generated (testnet coins have no real value, but use a fresh key)
  - Hot wallet private key (funded with ≥100 Nile TRX + 100 Nile USDT)
  - Cold wallet address (just an address, no key needed in env)
- [ ] TronGrid API key (free tier OK for Nile)
- [ ] Upstash Redis KV provisioned (free tier OK)
- [ ] Telegram bot token from @BotFather (use a test bot, not production)
- [ ] ngrok or similar tunnel for webhook delivery
- [ ] `.env.local` populated with all required vars, plus:
  - `DEPLOY_URL=<ngrok https URL>`
  - `CRON_SECRET` and `ADMIN_API_SECRET` (generate with `openssl rand -hex 32`)
  - `TELEGRAM_WEBHOOK_SECRET` (generate with `openssl rand -hex 16`)

### Step 1: Pre-flight

```bash
# Check env is complete
npx tsx scripts/e2e-nile.ts
```

All checks must pass. Fix anything flagged before continuing.

### Step 2: Migrate + seed

```bash
npx tsx scripts/migrate.mts
npx tsx scripts/seed.ts
```

Verify:
```sql
SELECT * FROM subscription_plans;   -- 3 rows
SELECT * FROM commission_config;    -- 1 row
SELECT * FROM ops_kill_switch;       -- 1 row (false/false)
```

### Step 3: Webhook

```bash
npx tsx scripts/setup-telegram-webhook.ts <ngrok https URL>

# Verify
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

Wait for `"ok":true` with `"url"` pointing to your ngrok URL.

### Step 4: Start dev server

```bash
npm run dev
```

Keep this terminal open. All requests route through ngrok → localhost:3000.

### Step 5: Smoke test — buy flow

As a test Telegram user (not admin):

1. **Open the bot**, send `/start`
   - [ ] Bot responds with welcome message and inline keyboard

2. **Tap "Buy access"** or send `/buy`
   - [ ] Bot sends invoice with a TRC20 deposit address

3. **Send USDT** (exact invoice amount) from a Nile testnet wallet to the deposit address
   - [ ] Record the tx hash: `____________________`

4. **Wait** ~1–2 minutes for `scan-payments` cron to fire
   - [ ] Trigger manually: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scan-payments`
   - [ ] Check `invoices` table: status should be `paid`, `paid_tx_hash` filled

5. **Verify subscription**
   - [ ] `subscriptions` table has a row with status `active`
   - [ ] User's `/start` now shows "Your access is active until …"

6. **Verify channel access**
   - [ ] User received an invite link or was added to the channel
   - [ ] If channel invite, user can join successfully

### Step 6: Smoke test — referral flow

1. **Get L1 referral code** from the first user (`/start` message or DB `ref_code`)

2. **Second Telegram user** sends `/start <L1_REF_CODE>`
   - [ ] `users.parent_ref_code` is set to the L1 code

3. **Second user buys** (repeat Step 5 steps 2–6)
   - [ ] L1 user gets commission rows in `commission_ledger` (level=1)
   - [ ] L1 user's `/start` shows referral activity

4. **Third Telegram user** sends `/start <L2_REF_CODE>` (use second user's code)
   - [ ] Third user buys
   - [ ] L2 user (second) gets L1 commission
   - [ ] L1 user (first) gets L2 commission (level=2)

### Step 7: Smoke test — renew

1. **First user** (with active sub) sends `/renew`
   - [ ] Bot offers plan options for renewal
   - [ ] Select a plan, pay invoice amount
   - [ ] New subscription starts at old subscription's `ends_at` (stacking)
   - [ ] No time lost

2. **If the sub expired**, renew and verify `starts_at` = now (not stacking)

### Step 8: Smoke test — expiry + nudges

1. **Temporarily set a subscription's `ends_at`** to 1h from now:
   ```sql
   UPDATE subscriptions SET ends_at = now() + interval '1 hour' WHERE status = 'active' LIMIT 1;
   ```

2. **Trigger expire-access:**
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/expire-access
   ```

3. **Verify:**
   - [ ] Nudge DM was sent (T-1h window)
   - [ ] `nudges_sent` row exists with window='T-1h'
   - [ ] No premature kick (ends_at still > now)

4. **Set ends_at to now:**
   ```sql
   UPDATE subscriptions SET ends_at = now() WHERE id = '<SUB_ID>';
   ```

5. **Trigger expire-access again. Verify:**
   - [ ] Soft kick executed (ban 35s + unban)
   - [ ] Subscription status = `expired`
   - [ ] Nudge not sent again (idempotent)

### Step 9: Smoke test — payout

1. **L1 user sets payout address:**
   - Send "Set payout address" (button in bot menu)
   - Reply with a Nile TRC20 address

2. **Check commissions are payable:**
   ```sql
   SELECT * FROM commission_ledger WHERE beneficiary_id = '<USER_ID>' AND status = 'payable';
   ```
   If any are `accrued` and past `unlock_at`, the payout cron promotes them.

3. **Trigger payout:**
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/payout-queue
   ```

4. **Verify:**
   - [ ] `payout_batches` row created with `status = 'broadcast'`
   - [ ] `tx_hash` set on the batch
   - [ ] `commission_ledger` rows marked `paid`
   - [ ] On Nile explorer, USDT arrived at the L1 user's address
   - [ ] Record the payout tx hash: `____________________`

### Step 10: Smoke test — sweep

1. **Verify deposit address has USDT:**
   Use TronGrid or the bot's TronService to check the address from Step 5.

2. **Trigger sweep:**
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sweep
   ```

3. **Verify:**
   - [ ] `invoices.swept` = `true` for the paid invoice
   - [ ] `invoices.sweep_tx_hash` set
   - [ ] USDT arrived at cold wallet on Nile explorer
   - [ ] Record the sweep tx hash: `____________________`

### Step 11: Admin + safety

1. **Admin stats:**
   - [ ] Admin user sends `/admin` → stats shown (paid invoices, hot balance, kill switch state)
   - [ ] Non-admin user sends `/admin` → no response or "not authorized"

2. **Kill switch — buy:**
   ```bash
   curl -X POST -H "Authorization: Bearer $ADMIN_API_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"buyDisabled":true,"reason":"smoke test"}' \
     http://localhost:3000/api/admin/kill-switch
   ```
   - [ ] User sends `/buy` → Bot says purchases are disabled
   - [ ] Re-enable: same curl with `"buyDisabled":false`

3. **Kill switch — payout:**
   - [ ] Disable payouts, trigger payout cron, verify EMPTY_RESULT
   - [ ] Re-enable payouts

4. **Health endpoint:**
   ```bash
   curl http://localhost:3000/api/health
   ```
   - [ ] Returns 200 with pending invoice count and kill switch status

### Smoke test sign-off

| # | Step | Tx Hash / Notes |
|---|------|----------------|
| 1 | Pre-flight |  |
| 2 | Migrate + seed |  |
| 3 | Webhook |  |
| 4 | Dev server |  |
| 5 | Buy flow |  |
| 6 | Referral flow |  |
| 7 | Renew |  |
| 8 | Expiry + nudges |  |
| 9 | Payout |  |
| 10 | Sweep |  |
| 11 | Admin + safety |  |

---

## Production rollout checklist

### Wallet setup

- [ ] **Cold wallet** created offline (air-gapped machine or hardware wallet). Address recorded. Private key NEVER touches an internet-connected machine.
- [ ] **Hot wallet** private key generated. Funded with:
  - [ ] ≥ 2 days of expected commission USDT volume
  - [ ] ≥ 100 TRX for sweep TRX top-ups
- [ ] **Deposit xprv** generated offline. Only the encrypted form stored in `TRON_DEPOSIT_XPRV`.
- [ ] `TRON_COLD_WALLET_ADDRESS` matches the offline cold wallet.
- [ ] `TRON_HOT_WALLET_PK` matches the hot wallet.

### Channel setup

- [ ] Bot promoted to admin in the target private channel
- [ ] Bot has `invite users` permission (for subscription grants)
- [ ] Bot has `ban users` permission (for soft kicks on expiry)
- [ ] `DEFAULT_CHANNEL_ID` env var matches the channel

### Telegram bot

- [ ] Bot token from @BotFather (production bot, not test)
- [ ] Webhook registered against production `DEPLOY_URL`
- [ ] `TELEGRAM_WEBHOOK_SECRET` set (random ≥16 chars)
- [ ] Bot commands configured in @BotFather:
  - `start - Start the bot`
  - `buy - Buy channel access`
  - `renew - Renew your subscription`
  - `withdraw - Withdraw commissions`

### Database

- [ ] Production Neon DB provisioned
- [ ] `DATABASE_URL` set (connection string with SSL)
- [ ] Migrations applied: `npx tsx scripts/migrate.mts`
- [ ] Seed data applied: `npx tsx scripts/seed.ts`
- [ ] Reviewed `subscription_plans` — prices and durations correct
- [ ] Reviewed `commission_config` — tier thresholds, rates, min payout correct
- [ ] `ops_kill_switch` is `(false, false)` — no accidental blocks

### Vercel deployment

- [ ] All env vars set in Vercel dashboard (including `CRON_SECRET`, `ADMIN_API_SECRET`)
- [ ] Vercel Cron jobs enabled and pointing at production URL:
  - `scan-payments`: `POST /api/cron/scan-payments` every 1 minute
  - `expire-access`: `POST /api/cron/expire-access` every 1 minute
  - `payout-queue`: `POST /api/cron/payout-queue` every 5 minutes
  - `sweep`: `POST /api/cron/sweep` every 10 minutes
- [ ] Cron jobs have `Authorization: Bearer <CRON_SECRET>` header configured
- [ ] Build succeeds on production
- [ ] No uncommitted local changes

### Observability

- [ ] Sentry DSN configured (`SENTRY_DSN` or `next.config.ts` with `sentry` config)
- [ ] Sentry receiving events (trigger a test error)
- [ ] Logtail or equivalent log drain configured
- [ ] `/api/health` returns 200 with correct data
- [ ] External uptime monitor (Better Uptime / Checkly) hitting `/api/health`
- [ ] Alert configured for `/api/health` returning non-200

### Safety limits

- [ ] `MAX_PAYOUT_PER_TX_USDT` set to a reasonable cap (per-transaction circuit breaker)
- [ ] `MAX_PAYOUTS_PER_HOUR` set to a reasonable rate limit
- [ ] `ADMIN_TG_IDS` set (comma-separated numeric Telegram user IDs)
- [ ] `ADMIN_API_SECRET` set (random ≥16 chars, different from `CRON_SECRET`)
- [ ] Admin can access `/admin` and see stats

### Pre-launch

- [ ] Nile testnet smoke test completed (all steps in section above passed)
- [ ] Production hot wallet funded
- [ ] Buy a subscription yourself as first real user — verify full flow
- [ ] Friend/colleague buys as second user through your referral code — verify commission
- [ ] Monitor logs during first 24h for anomalies
- [ ] Set up daily commission reconciliation (compare `commission_ledger.paid` sums against hot wallet outflows)
