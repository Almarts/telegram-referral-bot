# Telegram Referral Bot — Design

Status: validated through brainstorming on 2026-05-28
Audience: implementer (the next session) and the operator (you)

## 1. Goal

A Telegram bot that:

- Sells fixed-duration access to a private channel (1M, 1Y, …) paid in **TRON USDT (TRC20)**.
- Removes the user from the channel when access expires unless renewed.
- Operates a **2-level cascading referral program** where the L2 referrer earns from the L1's commission, not from the original payment.
- Lets anyone register as a referrer (with or without a parent code), see their earnings broken down by L1/L2, and withdraw to a TRC20 address.
- Supports both **instant** and **deferred** commission payouts (admin-configurable).
- Deploys on **Vercel** (Next.js + grammY + tronweb, TypeScript).

## 2. Locked-in decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | **Payment rail:** self-custodial TRON USDT (TRC20). No third-party gateway. |
| 2 | **Chain detection:** Vercel Cron polling TronGrid every 30s. |
| 3 | **Referral depth:** fixed 2 levels, cascading (L2 % of L1's commission). |
| 4 | **L1 commission:** step function on **lifetime** count of paid invoices attributed to the L1 (e.g. `<10 → 20%`, `≥10 → 30%`). Tier list is admin-configurable. |
| 5 | **L2 commission:** fixed % of L1's commission. |
| 6 | **Parent locking:** `parent_ref_code` is captured at first `/start` and is immutable thereafter. |
| 7 | **Invoice TTL:** 30 minutes. |
| 8 | **Multi-channel:** v1 ships single-channel; schema already supports adding channels later. |
| 9 | **Renewal grace window:** 0 days. Expired sub renewing later starts at `now()`, not from `old.ends_at`. |
| 10 | **Min payout batching:** admin-configurable; default **$50**. |
| 11 | **Clawback model:** refunds insert negative ledger rows; future commissions net off until the beneficiary's balance ≥ 0. No chasing already-paid funds. |
| 12 | **Stack:** Next.js (TypeScript) + grammY + tronweb on Vercel. |
| 13 | **Database:** Postgres (Neon or Vercel Postgres). |
| 14 | **Hot/cold split:** deposit HD wallet → cold treasury; separate hot wallet funds outgoing commission payouts. |

## 3. Architecture

```
┌────────────────────┐        webhooks         ┌─────────────────────┐
│  Telegram users    │ ───────────────────────▶│   Next.js on Vercel │
│  (/start, /buy …)  │                         │   (grammY webhook)  │
└────────────────────┘                         │                     │
                                               │  API routes:        │
┌────────────────────┐                         │   • /api/tg/webhook │
│  TronGrid REST     │◀──── HTTPS polls ───────│   • /api/cron/*     │
└────────────────────┘                         │   • /api/admin/*    │
                                               └──────────┬──────────┘
                                                          │
                          ┌───────────────────────────────┼───────────────────────────────┐
                          ▼                               ▼                               ▼
                ┌────────────────┐               ┌──────────────────┐             ┌─────────────────────┐
                │ Postgres       │               │ KV (Upstash      │             │ Secrets             │
                │ source of truth│               │ /Vercel KV)      │             │ • deposit HD xprv   │
                │                │               │ • cron leases    │             │ • hot wallet key    │
                │                │               │ • rate limits    │             │ • bot token         │
                └────────────────┘               └──────────────────┘             └─────────────────────┘

Vercel Cron jobs (scheduled API routes):
  • every 30s  → /api/cron/scan-payments
  • every 60s  → /api/cron/expire-access
  • every  5m  → /api/cron/payout-queue
  • every 10m  → /api/cron/sweep
```

Key invariants:

- Postgres is the only source of truth. Cron jobs are stateless, **idempotent**, and protected by a KV-based single-tick lease (`SET cron:<name> <run_id> NX EX 90`).
- Private keys never touch a request path. Only `sweep` and `payout-queue` derive/sign; signers are pulled from env, held in a local variable, and dropped after use.
- Telegram membership is enforced via Bot API (`createChatInviteLink`, `banChatMember`, `unbanChatMember`). The bot must be a channel admin with invite + ban rights.

## 4. Data model (Postgres)

```sql
users (
  id              uuid pk,
  tg_user_id      bigint unique,
  tg_username     text,
  tg_lang         text,
  ref_code        text unique,            -- own shareable code, 6-char base32
  parent_ref_code text null,              -- immutable after creation
  payout_address  text null,              -- TRC20
  payout_address_changed_at timestamptz,  -- 24h cooling-off window
  created_at      timestamptz
);

subscription_plans (
  id              smallint pk,
  name            text,
  duration_days   int,
  price_usdt      numeric(18,6),
  active          bool
);

invoices (
  id              uuid pk,
  user_id         uuid fk users,
  plan_id         smallint fk plans,
  deposit_address text unique,            -- HD-derived, one per invoice
  deriv_index     int,                    -- BIP32 index on m/44'/195'/0'/0/*
  amount_usdt     numeric(18,6),
  status          enum('pending','paid','expired','refunded'),
  paid_tx_hash    text unique null,       -- idempotency anchor for settlement
  paid_at         timestamptz null,
  expires_at      timestamptz,
  has_partial_payment bool default false,
  swept           bool default false,
  sweep_tx_hash   text null,
  created_at      timestamptz
);
-- ix: status+expires_at, status+swept

subscriptions (
  id              uuid pk,
  user_id         uuid fk users,
  invoice_id      uuid fk invoices,
  starts_at       timestamptz,
  ends_at         timestamptz,
  channel_id      bigint,
  status          enum('active','expired','revoked')
);
-- ix: status+ends_at

commission_ledger (                       -- append-only
  id              uuid pk,
  invoice_id      uuid fk invoices,
  beneficiary_id  uuid fk users,
  level           smallint,               -- 1 or 2
  basis_usdt      numeric(18,6),          -- payment (L1) or L1 commission (L2)
  rate_bps        int,                    -- frozen at accrual time
  amount_usdt     numeric(18,6),          -- can be negative on clawback
  unlock_at       timestamptz,            -- = paid_at (instant) or +N days (deferred)
  status          enum('accrued','payable','paid','clawed_back'),
  batch_id        uuid null,
  paid_tx_hash    text null,
  unique (invoice_id, beneficiary_id, level)   -- accrual idempotency
);
-- ix: beneficiary_id+status, unlock_at+status

commission_config (                       -- single row
  l1_tiers        jsonb,                  -- [{"min":0,"bps":2000},{"min":10,"bps":3000}]
  l2_bps          int,
  payout_mode     enum('instant','deferred'),
  defer_days      int,
  min_payout_usdt numeric(18,6) default 50
);

payout_batches (
  id              uuid pk,
  beneficiary_id  uuid fk users,
  amount_usdt     numeric(18,6),
  tx_hash         text null,
  broadcast_at    timestamptz null,
  status          enum('pending','broadcast','confirmed','failed')
);

nudges_sent (                             -- expiry-reminder idempotency
  sub_id          uuid fk subscriptions,
  window          text,                   -- '72h','24h','1h'
  sent_at         timestamptz,
  pk (sub_id, window)
);

ops_kill_switch (
  id              smallint pk default 1,  -- single row
  buy_disabled    bool default false,
  payout_disabled bool default false,
  reason          text,
  set_at          timestamptz
);
```

## 5. Flows

### 5.1 Onboarding (`/start [code]`)

1. Upsert `users` row keyed by `tg_user_id`.
2. If row was **newly created** and `[code]` matches an existing `ref_code`: set `parent_ref_code=[code]`. Otherwise ignore (locked).
3. Generate `ref_code` if missing (6-char base32; retry on unique violation).
4. Reply with main menu: **Buy access · My referrals · Earnings · Set payout address**.

### 5.2 Buy (`/buy <plan>`)

1. Validate plan is active.
2. Insert `invoices` row with `status='pending'`, `expires_at=now()+30min`, `amount_usdt=plan.price_usdt`.
3. HD-derive deposit address from master xprv at `m/44'/195'/0'/0/{deriv_index}` (monotonic counter).
4. Reply with address (copy button + QR), exact amount in USDT-TRC20, countdown, and "I've paid" button (triggers an early scan; no state change).

### 5.3 Payment detection (`/api/cron/scan-payments`, every 30s)

```
LEASE cron:scan-payments (KV, 90s)
FOR each invoice WHERE status='pending'
                   AND expires_at > now() - 24h    -- catch late payments
                   LIMIT 200:
  GET TronGrid /v1/accounts/{deposit_address}/transactions/trc20?contract=USDT
  FOR each confirmed transfer not yet recorded:
    IF transfer.to == deposit_address AND transfer.amount >= invoice.amount_usdt:
      BEGIN TX
        SELECT ... FOR UPDATE WHERE id=invoice.id AND status='pending'
        UPDATE invoice SET status='paid', paid_tx_hash=..., paid_at=now()  -- UNIQUE paid_tx_hash
        INSERT subscription(starts_at=now(), ends_at=now()+plan.duration_days,
                             channel_id=$DEFAULT_CHANNEL_ID, status='active')
        accrue_commissions(invoice)                                       -- §5.6
      COMMIT
      enqueue: send_one_shot_invite_link(user, channel_id)
    ELSE IF transfer.amount < invoice.amount_usdt:
      UPDATE invoice SET has_partial_payment=true
      DM user about partial payment
```

Edge cases:

- **Underpayment:** flag `has_partial_payment`, DM user, keep invoice open past `expires_at`, manual claim by admin if needed.
- **Overpayment:** settle, log overage; no automatic refund.
- **Late payment** (post-expiry, pre-sweep): admin-only claim.
- **Double-pay to same address:** first transfer settles; subsequent transfers go to treasury via sweep; user DMed.
- **Idempotency:** `paid_tx_hash` is UNIQUE on `invoices`; retried cron runs cannot double-credit.

### 5.4 Channel grant

`createChatInviteLink(chat_id, member_limit=1, expire_date=now+1h)` → DM to user. One-shot link prevents resharing.

### 5.5 Expiry & renewal (`/api/cron/expire-access`, every 60s)

```
-- Reminder nudges at T-72h, T-24h, T-1h (idempotent via nudges_sent)
SELECT s.*, u.tg_user_id FROM subscriptions s JOIN users u ON u.id=s.user_id
 WHERE s.status='active'
   AND s.ends_at BETWEEN now()+W AND now()+W+60s
   AND NOT EXISTS (SELECT 1 FROM nudges_sent WHERE sub_id=s.id AND window=W);
→ DM /renew CTA, mark nudge sent.

-- Hard expiry
SELECT … FOR UPDATE SKIP LOCKED
 WHERE status='active' AND ends_at <= now() LIMIT 200;
FOR each row:
   banChatMember(channel_id, tg_user_id, until_date=now+35s)   -- soft kick
   unbanChatMember(channel_id, tg_user_id)                     -- door reopenable
   UPDATE subscriptions SET status='expired'
   DM user with /renew CTA
```

Renewal (`/renew`):

- Active sub: new invoice's resulting subscription gets `starts_at = old.ends_at` (stacks; no lost time).
- Expired sub: `starts_at = now()` (locked decision: grace window = 0).
- Renewal payments accrue commissions normally — same locked chain earns again. `accrue_commissions` must **not** have a "first invoice only" guard.

### 5.6 Commission accrual (`accrue_commissions`, called inside the settlement TX)

```python
def accrue_commissions(invoice):
    buyer = users[invoice.user_id]
    if not buyer.parent_ref_code:
        return                                       # no chain → nothing to accrue

    l1 = users.find_by_ref_code(buyer.parent_ref_code)
    cfg = commission_config.current()

    # Lifetime paid-invoice count attributed to L1, EXCLUDING this invoice
    l1_count = (SELECT count(*) FROM invoices i
                JOIN users u ON i.user_id=u.id
                WHERE u.parent_ref_code = l1.ref_code
                  AND i.status='paid'
                  AND i.id != invoice.id)
    l1_bps = pick_tier(cfg.l1_tiers, l1_count)       # frozen below
    l1_amt = invoice.amount_usdt * l1_bps / 10000

    insert commission_ledger(
        invoice_id=invoice.id, beneficiary_id=l1.id, level=1,
        basis_usdt=invoice.amount_usdt, rate_bps=l1_bps, amount_usdt=l1_amt,
        unlock_at = invoice.paid_at if cfg.payout_mode=='instant'
                    else invoice.paid_at + interval(cfg.defer_days days),
        status='accrued')

    if l1.parent_ref_code:
        l2 = users.find_by_ref_code(l1.parent_ref_code)
        l2_amt = l1_amt * cfg.l2_bps / 10000
        insert commission_ledger(
            invoice_id=invoice.id, beneficiary_id=l2.id, level=2,
            basis_usdt=l1_amt, rate_bps=cfg.l2_bps, amount_usdt=l2_amt,
            unlock_at=..., status='accrued')
```

`rate_bps` is **frozen** into the row, so a later tier upgrade does not retro-rewrite past accruals. The `(invoice_id, beneficiary_id, level)` UNIQUE constraint provides per-row idempotency.

### 5.7 Payout (`/api/cron/payout-queue`, every 5m)

```
LEASE cron:payout-queue
IF ops_kill_switch.payout_disabled: ABORT

-- Promote due rows
UPDATE commission_ledger SET status='payable'
 WHERE status='accrued' AND unlock_at <= now();

FOR beneficiary IN (
  SELECT beneficiary_id, SUM(amount_usdt) total
  FROM commission_ledger WHERE status='payable'
  GROUP BY beneficiary_id HAVING SUM(amount_usdt) >= cfg.min_payout_usdt
):
  IF beneficiary.payout_address IS NULL: CONTINUE          -- DM nudge
  IF now() - beneficiary.payout_address_changed_at < 24h: CONTINUE   -- cooling off

  BEGIN TX
    SELECT id, amount_usdt FROM commission_ledger
     WHERE beneficiary_id=$1 AND status='payable'
     FOR UPDATE SKIP LOCKED
    -- guards
    CHECK total <= MAX_PAYOUT_PER_TX                       -- circuit breaker
    INSERT payout_batches(beneficiary_id=$1, amount_usdt=total, status='pending') → batch_id
    UPDATE commission_ledger SET status='paid', batch_id=batch_id
     WHERE id IN (...)
  COMMIT

  tx_hash = tron.send_usdt(beneficiary.payout_address, total)   -- only signing call
  UPDATE payout_batches SET tx_hash=$1, status='broadcast', broadcast_at=now()
  UPDATE commission_ledger SET paid_tx_hash=$1 WHERE batch_id=$2
```

`FOR UPDATE SKIP LOCKED` before broadcast guarantees each payable row is owned by exactly one batch before any TRON tx is signed → no double-pay under concurrent cron invocations. Failed broadcast → admin task flips batch back to a payable state via an explicit retry route.

### 5.8 Refund / clawback

1. Admin opens invoice, hits Refund (TOTP required).
2. Insert `refund_intents` row + queue outgoing TRC20 tx to user-provided address.
3. On successful broadcast:
   - Insert **negative** `commission_ledger` rows for L1/L2 (same `invoice_id`, status `clawed_back`).
   - `subscription.status='revoked'`; kick the user from the channel.
4. Beneficiary's `payable` sum reflects the negative entries; future commissions net off until balance ≥ 0. Never claw back already-paid funds.

### 5.9 Sweep (`/api/cron/sweep`, every 10m)

```
LEASE cron:sweep
SELECT deposit_address, deriv_index FROM invoices
 WHERE status='paid' AND swept=false AND paid_at < now() - 15m
 LIMIT 100;
FOR each:
  balance = tron.usdt_balance(deposit_address)
  if balance == 0:
     UPDATE invoices SET swept=true; CONTINUE
  signer = derive(xprv, deriv_index)
  if tron.trx_balance(deposit_address) < TRX_FOR_ONE_TRANSFER:
     tron.send_trx(from=HOT_WALLET, to=deposit_address, amount=TRX_FOR_ONE_TRANSFER)
  tx = tron.send_usdt(from=deposit_address, to=COLD_WALLET, amount=balance)
  UPDATE invoices SET swept=true, sweep_tx_hash=tx
```

The "send TRX to deposit address before sweeping" step covers TRC20 energy/bandwidth costs on fresh addresses. Migrate to `delegateResource` from the hot wallet once daily sweep volume justifies the staking trade-off (~200+ sweeps/day).

## 6. Referrer view in the bot

A referrer is just a user; the menu is the same for everyone.

**`My referrals` screen**

```
Your code: ABC123  [copy]
Share link: t.me/yourbot?start=ABC123  [share]

Direct (L1) referrals:    47 paying users
  Lifetime invoices paid: 112
  Current tier:           ≥10 → 30%  (next at 50 → 35%)

Indirect (L2) referrals:   8 paying users (via 3 of your L1s)
  Lifetime invoices paid: 21
```

**`Earnings` screen**

```
Balance (paid out):        $1,420.00
Payable now:                  $85.00      → batch threshold $50 ✓ next payout ≤ 5 min
Pending (deferred until …):  $210.00
Lifetime earned:           $1,715.00

Breakdown (last 30d):
   L1 direct:              $312.00   (38 payments)
   L2 cascade:              $24.00   ( 9 payments)

Recent payouts:
   2026-05-26  tx d8a1…  $180.00
   2026-05-19  tx 9f4c…  $220.00

[ Set / change payout address ]
[ Withdraw now (if ≥ $50 payable) ]
```

All figures are sums over `commission_ledger` grouped by `(beneficiary_id, status, level)`. `Withdraw now` reuses the payout-queue code path scoped to one beneficiary; rate-limited to one withdraw per 60s per user.

Privacy: a referrer never sees Telegram handles or IDs of downstream users. Only counts and aggregate amounts.

## 7. Key management & treasury

Three wallets, three roles:

- **Deposit HD xprv** — `m/44'/195'/0'/0/*`. Only public addresses persist in DB; xprv lives in env.
- **Hot wallet** (single TRC20 address) — funds outgoing commission payouts. Balance kept ≤ ~7 days of expected payouts.
- **Cold wallet** (single TRC20 address) — treasury, receives sweeps. Never signed from Vercel.

Secrets fetched through a `getSigner()` helper so v1's env-var-based storage can be swapped for KMS without touching call sites.

Circuit breakers, enforced in code:

- `MAX_PAYOUT_PER_TX` — refuse to broadcast above (e.g. $1,000).
- `MAX_PAYOUTS_PER_HOUR` — sliding-window counter in KV.
- `HOT_WALLET_REFILL_ALERT` — DM admin if hot < 2 days expected payouts.
- Any cap breach: flip `ops_kill_switch`, block `/buy` and payout cron, DM admin, raise dashboard banner. No silent failure.

Admin-only signing operations (refunds, treasury moves) are never wired to bot DM. They go through `/api/admin/*` routes guarded by IP allowlist + Telegram admin id + TOTP.

## 8. Admin, observability & ops

- **Bot `/admin` commands** for read-only queries: stats today, list pending invoices, search user, view a referrer's chain.
- **Web `/api/admin/*` + Next.js admin pages** for writes: edit `commission_config`, change plans, issue refunds, flip kill switch, view payout history.
- **Structured logs** (one JSON line per request) → Logtail / Axiom / Better Stack.
- **Sentry** with `cron_route` tag for dedicated alert channels.
- **`/api/health`** returns last successful tick of each cron, hot wallet USDT + TRX balances, pending-invoice count. External uptime monitor pings every 60s.
- **Pager alerts:** hot wallet refill, 2× consecutive cron failure, kill switch on, bot lost channel admin rights.
- **Metrics:** invoice → paid conversion, time-to-payment p50/p95, MAU subs, renewal churn, L1 tier distribution, top-10 referrers' share of GMV.

Idempotency, cross-cutting:

- Each cron route wraps body in a KV lease (`SET cron:<name> <run_id> NX EX 90`). Second concurrent invocation no-ops.
- `tx_hash` uniqueness for settlements; `(invoice_id, beneficiary_id, level)` uniqueness for accruals; batch id for payouts.

## 9. Vercel-specific notes

- Pro plan required (cron tick < 1 day).
- Function timeout caps end-to-end → cron routes paginate (e.g. 200 invoices per tick). Cron tick × chunk size = max in-flight invoice volume.
- Cold starts ~300ms — fine for bot webhook, irrelevant for cron.
- Connection pooling: Neon serverless driver, Prisma Accelerate, or Supabase pooler. Plain `pg` will exhaust connections under cron + webhook load.

## 10. Explicit non-goals (v1)

- Auto-renewal / card-on-file. TRC20 has no equivalent; we send timely renewal nudges instead.
- Multi-chain payments. TRON USDT only.
- Multi-channel UX. Schema-ready, but the buy menu and commission attribution stay single-channel for v1.
- KYC. The bot does not collect identity beyond Telegram id and a payout TRC20 address.
- Stars-based payment fallback.
