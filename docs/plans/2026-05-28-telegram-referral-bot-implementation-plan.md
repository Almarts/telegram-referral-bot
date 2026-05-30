# Telegram Referral Bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a Telegram bot that sells private-channel subscriptions for TRON-USDT, runs a 2-level cascading referral program, and deploys on Vercel.

**Architecture:** Next.js (App Router) on Vercel. Telegram webhook + Vercel Cron API routes share one Postgres database (Neon) and one Redis KV (Upstash). Self-custodial TRON wallets — HD-derived per-invoice deposit addresses, a hot wallet for commission payouts, a cold wallet for treasury. Every cron route is idempotent (KV lease + DB uniqueness constraints) and every signing operation is fenced behind DB row-locks before any TRON tx is broadcast.

**Tech Stack:** Next.js 15 (TypeScript) · grammY 1.x · tronweb 5.x · Drizzle ORM + drizzle-kit · @neondatabase/serverless · @upstash/redis · vitest · zod · pino · @sentry/nextjs

**Design doc:** [2026-05-28-telegram-referral-bot-design.md](./2026-05-28-telegram-referral-bot-design.md) — read before starting.

**Conventions for the executor:**
- TDD. Every feature lands as test-first.
- One small commit per task, message style: `feat(scope): …` / `chore: …` / `test(scope): …`.
- Never log secrets, never log full tx payloads, never log full Telegram message bodies.
- All money is `numeric(18, 6)` (USDT base) — never `number`; use the `decimal.js` lib or string arithmetic.
- Schemas validated with `zod` at every boundary (webhook bodies, env, admin requests).
- All TRON RPC goes through a `TronService` interface so tests use a fake.

---

## Phase A — Foundation

### Task A1: Scaffold the Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `.gitignore`, `.editorconfig`, `.nvmrc`
- Create: `app/page.tsx` (placeholder "OK"), `app/layout.tsx`

**Step 1: Init**

```bash
cd /media/kiryl/stuff2/workspace/claude/code/telegram
git init
npx create-next-app@latest . --ts --app --eslint --src-dir=false --no-tailwind --import-alias "@/*" --use-npm
```

Pick `No` for Turbopack default, accept the rest.

**Step 2: Pin Node version**

Write `.nvmrc`:
```
20
```

Add `"engines": { "node": ">=20.0.0" }` to `package.json`.

**Step 3: Install runtime deps**

```bash
npm i grammy tronweb @neondatabase/serverless drizzle-orm @upstash/redis zod pino decimal.js @sentry/nextjs
```

**Step 4: Install dev deps**

```bash
npm i -D drizzle-kit vitest @vitest/coverage-v8 @types/node tsx dotenv
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold next.js project with runtime + dev deps"
```

---

### Task A2: Env loading and validation

**Files:**
- Create: `lib/env.ts`, `.env.example`
- Test: `lib/env.test.ts`

**Step 1: Write failing test**

```ts
// lib/env.test.ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("rejects when required keys are missing", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("returns typed env when complete", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x",
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_WEBHOOK_SECRET: "s",
      DEFAULT_CHANNEL_ID: "-1001234567890",
      TRON_DEPOSIT_XPRV: "xprv...",
      TRON_HOT_WALLET_PK: "0x...",
      TRON_COLD_WALLET_ADDRESS: "T...",
      TRONGRID_API_KEY: "k",
      UPSTASH_REDIS_REST_URL: "https://x",
      UPSTASH_REDIS_REST_TOKEN: "t",
      ADMIN_TG_IDS: "1,2,3",
      MAX_PAYOUT_PER_TX_USDT: "1000",
      MAX_PAYOUTS_PER_HOUR: "30",
    });
    expect(env.DEFAULT_CHANNEL_ID).toBe(-1001234567890n);
    expect(env.ADMIN_TG_IDS).toEqual([1n, 2n, 3n]);
  });
});
```

**Step 2: Run, expect fail**

```bash
npx vitest run lib/env.test.ts
```

Expected: failure (module not found).

**Step 3: Implement `lib/env.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  DEFAULT_CHANNEL_ID: z.string().regex(/^-?\d+$/).transform(BigInt),
  TRON_DEPOSIT_XPRV: z.string().min(1),
  TRON_HOT_WALLET_PK: z.string().min(1),
  TRON_COLD_WALLET_ADDRESS: z.string().min(34).max(34),
  TRONGRID_API_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  ADMIN_TG_IDS: z.string().transform((s) => s.split(",").filter(Boolean).map((x) => BigInt(x.trim()))),
  MAX_PAYOUT_PER_TX_USDT: z.string().regex(/^\d+(\.\d+)?$/),
  MAX_PAYOUTS_PER_HOUR: z.string().regex(/^\d+$/).transform(Number),
});

export type Env = z.infer<typeof schema>;
export function parseEnv(src: Record<string, string | undefined> = process.env): Env {
  return schema.parse(src);
}
export const env: Env = parseEnv();
```

Write `.env.example` with every key above and a one-line comment per key.

Add `.env.local` to `.gitignore` (already there from create-next-app; verify).

**Step 4: Run, expect pass**

```bash
npx vitest run lib/env.test.ts
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(env): zod-validated env loader"
```

---

### Task A3: Vitest config + npm scripts

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

**Step 1: Vitest config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: { provider: "v8", reporter: ["text", "html"] },
    setupFiles: ["./test/setup.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Create `test/setup.ts`:

```ts
import { config } from "dotenv";
config({ path: ".env.test" });
```

**Step 2: Add scripts to `package.json`**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx scripts/migrate.ts",
  "db:seed": "tsx scripts/seed.ts"
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: vitest config + npm scripts"
```

---

### Task A4: Drizzle setup

**Files:**
- Create: `drizzle.config.ts`, `db/schema.ts` (empty for now), `db/client.ts`, `scripts/migrate.ts`

**Step 1: `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

**Step 2: `db/client.ts`**

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { env } from "@/lib/env";

const sql = neon(env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export type DB = typeof db;
```

**Step 3: `db/schema.ts`** — leave with an `export {}` placeholder.

**Step 4: `scripts/migrate.ts`**

```ts
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);
await migrate(db, { migrationsFolder: "./db/migrations" });
console.log("migrated");
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore(db): drizzle config + neon client"
```

---

## Phase B — Schema and seeds

### Task B1: Schema migration (all tables)

**Files:**
- Modify: `db/schema.ts`

**Step 1: Write the schema** exactly per design §4. Use drizzle's `pgTable`, `pgEnum`, `uuid`, `numeric`, `bigint`, `timestamp`, `jsonb`, `boolean`, `smallint`, `text`. Wire FKs and indexes as listed:
- `users(tg_user_id UNIQUE, ref_code UNIQUE, parent_ref_code, payout_address, payout_address_changed_at)`
- `subscription_plans(id smallint pk, …)`
- `invoices` — incl. `paid_tx_hash UNIQUE NULL`, `deposit_address UNIQUE`, ix `(status, expires_at)`, `(status, swept)`
- `subscriptions` — ix `(status, ends_at)`
- `commission_ledger` — UNIQUE `(invoice_id, beneficiary_id, level)`; ix `(beneficiary_id, status)`, `(unlock_at, status)`
- `commission_config` (single row id=1)
- `payout_batches`
- `nudges_sent` (composite pk `(sub_id, window)`)
- `ops_kill_switch` (single row id=1)

**Step 2: Generate migration**

```bash
npm run db:generate
```

This creates `db/migrations/0000_*.sql`. Inspect it.

**Step 3: Apply to Neon (dev branch)**

```bash
DATABASE_URL='...' npm run db:migrate
```

**Step 4: Smoke test** the connection in a throwaway script:

```bash
npx tsx -e "import {db} from './db/client'; import {users} from './db/schema'; console.log(await db.select().from(users).limit(1))"
```

Expect `[]` (no rows).

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): schema + initial migration"
```

---

### Task B2: Seeds

**Files:**
- Create: `scripts/seed.ts`

**Step 1: Write the seed**

Seed:
- `subscription_plans`: `{1, "1 month", 30, "9.99", true}`, `{2, "3 months", 90, "24.99", true}`, `{3, "1 year", 365, "79.99", true}`.
- `commission_config`: `{ l1_tiers: [{min:0,bps:2000},{min:10,bps:3000}], l2_bps: 1000, payout_mode: "instant", defer_days: 0, min_payout_usdt: "50" }`.
- `ops_kill_switch`: defaults `false`/`false`.

Idempotent via `ON CONFLICT DO NOTHING` on the single-row keys.

**Step 2: Run**

```bash
npm run db:seed
```

**Step 3: Verify**

```bash
npx tsx -e "import {db} from './db/client'; import {subscriptionPlans} from './db/schema'; console.log(await db.select().from(subscriptionPlans))"
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): seed plans, commission config, kill switch"
```

---

## Phase C — Cross-cutting helpers (with tests)

### Task C1: Money helper

**Files:**
- Create: `lib/money.ts`, `lib/money.test.ts`

**Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { mul, add, gte, fromBps } from "./money";

describe("money", () => {
  it("multiplies stably to 6 decimals", () => {
    expect(mul("9.99", "0.30")).toBe("2.997000");
  });
  it("adds", () => {
    expect(add("1.000001", "0.000001")).toBe("1.000002");
  });
  it("gte handles strings", () => {
    expect(gte("10.000000", "9.999999")).toBe(true);
    expect(gte("9.999999", "10.000000")).toBe(false);
  });
  it("fromBps applies bps to amount", () => {
    expect(fromBps("100.000000", 2000)).toBe("20.000000");
  });
});
```

**Step 2: Run, expect fail.**

**Step 3: Implement** using `decimal.js`, fix scale to 6, return strings.

**Step 4: Run, expect pass.**

**Step 5: Commit.**

```bash
git commit -am "feat(money): decimal helpers fixed at 6dp"
```

---

### Task C2: Ref code generator

**Files:**
- Create: `lib/refcode.ts`, `lib/refcode.test.ts`

**Step 1: Failing test**

```ts
describe("genRefCode", () => {
  it("returns 6-char base32 (Crockford)", () => {
    for (let i = 0; i < 100; i++) {
      const c = genRefCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    }
  });
  it("createUniqueRefCode retries on collision and surfaces failure", async () => {
    const calls: string[] = [];
    const tryInsert = async (code: string) => {
      calls.push(code);
      return calls.length >= 3; // succeed on 3rd
    };
    const code = await createUniqueRefCode(tryInsert);
    expect(calls).toHaveLength(3);
    expect(code).toBe(calls[2]);
  });
});
```

**Step 2-5:** Implement (Crockford base32, exclude I/L/O/U; `createUniqueRefCode(tryInsert, maxAttempts=8)`), run, commit.

```bash
git commit -am "feat(refcode): 6-char base32 generator with collision retry"
```

---

### Task C3: KV cron-lease helper

**Files:**
- Create: `lib/cron-lease.ts`, `lib/cron-lease.test.ts`

**Step 1: Failing test** — fake the Redis client with a tiny in-memory mock; assert second `withLease` call no-ops while first is held; assert lease expires after TTL; assert exception releases lease.

**Step 2-5:** Implement with `@upstash/redis` `SET key value NX EX 90` semantics; surface a simple `withLease(name, ttlSeconds, fn)`. Commit.

```bash
git commit -am "feat(cron-lease): KV-based single-tick lease wrapper"
```

---

### Task C4: TronService interface + fake

**Files:**
- Create: `lib/tron/types.ts`, `lib/tron/fake.ts`, `lib/tron/index.ts`, `lib/tron/fake.test.ts`

**Step 1: Define the interface**

```ts
// lib/tron/types.ts
export interface UsdtTransfer {
  txHash: string;
  from: string;
  to: string;
  amountUsdt: string;          // 6dp string
  blockTimestamp: number;
  confirmed: boolean;
}

export interface TronService {
  deriveDepositAddress(index: number): { address: string };
  signerForIndex(index: number): { sign(unsignedTx: unknown): Promise<unknown> };
  hotWalletSigner(): { sign(unsignedTx: unknown): Promise<unknown> };

  listUsdtTransfersTo(address: string, sinceMs?: number): Promise<UsdtTransfer[]>;
  usdtBalance(address: string): Promise<string>;
  trxBalance(address: string): Promise<string>;

  sendUsdt(opts: { fromAddress: string; signer: unknown; toAddress: string; amount: string }): Promise<{ txHash: string }>;
  sendTrx(opts: { fromAddress: string; signer: unknown; toAddress: string; amountSun: bigint }): Promise<{ txHash: string }>;
}
```

**Step 2: Write fake** — `lib/tron/fake.ts` exposes `createFakeTron({ ... })` that:
- Derives `T${index.toString().padStart(33, "0")}` style addresses (not real-format but distinct).
- Holds in-memory ledgers for pending transfers and balances.
- `sendUsdt` debits/credits in-memory.
- Has helpers `__pretendIncomingTransfer({to, amount, txHash})` for tests.

**Step 3: Tests** for the fake (round-trip transfer, balance updates).

**Step 4: Real wiring** — `lib/tron/index.ts`:

```ts
import { env } from "@/lib/env";
import { createRealTron } from "./real";   // implemented in Task C5
import { createFakeTron } from "./fake";

export const tron = process.env.TRON_FAKE === "1"
  ? createFakeTron()
  : createRealTron({ xprv: env.TRON_DEPOSIT_XPRV, hotPk: env.TRON_HOT_WALLET_PK, apiKey: env.TRONGRID_API_KEY });
```

(`./real` is stubbed in this task; implemented next.)

**Step 5: Commit.**

```bash
git commit -am "feat(tron): service interface + in-memory fake"
```

---

### Task C5: Real Tron implementation (HD derivation + TronGrid)

**Files:**
- Create: `lib/tron/real.ts`, `lib/tron/real.test.ts`

**Step 1: Failing test for HD derivation**

Hardcode a known xprv → expected addresses for indices 0..2 (compute once via a throwaway script, then pin). Pin via vector in the test.

**Step 2: Implement** using `tronweb.utils.accounts.generateAccountWithMnemonic` is not the path — use `tronweb` + BIP32 (`@scure/bip32`) on path `m/44'/195'/0'/0/{index}` then derive TRON address from the secp256k1 pubkey (`tronweb.address.fromPrivateKey`).

**Step 3: `listUsdtTransfersTo`** — hit `https://api.trongrid.io/v1/accounts/{addr}/transactions/trc20?contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&only_confirmed=true&limit=200`, map response, filter `to == address`, normalize amount from atomic (6dp) to decimal string. Honor `X-API-KEY` header.

**Step 4: `sendUsdt` / `sendTrx`** — use `tronweb.transactionBuilder.triggerSmartContract` for USDT contract `transfer`; `tronweb.transactionBuilder.sendTrx` for native; sign + broadcast.

**Step 5: Tests** — only the pure pieces (derivation, address format, transfer parsing). Network calls covered later by smoke test on TRON Nile testnet.

**Step 6: Commit.**

```bash
git commit -am "feat(tron): real HD derivation + TronGrid client + send helpers"
```

---

## Phase D — Bot skeleton and onboarding

### Task D1: grammY webhook route

**Files:**
- Create: `app/api/tg/webhook/route.ts`, `bot/bot.ts`, `bot/handlers/start.ts`, `bot/bot.test.ts`

**Step 1: Failing test** — feed a synthetic Telegram `Update` with `/start` to the bot via grammY's `bot.handleUpdate`, capture the reply via a fake `bot.api`. Expect a reply with the menu keyboard.

**Step 2: Implement `bot/bot.ts`** — initialize `Bot<MyContext>(env.TELEGRAM_BOT_TOKEN)`, register `/start`, `/buy`, `/renew`, `/admin`. Export `bot`.

**Step 3: Implement `start.ts`** — for now: text "Welcome" + keyboard `Buy access · My referrals · Earnings · Set payout address`. User upsert comes in D2.

**Step 4: Webhook route**

```ts
// app/api/tg/webhook/route.ts
import { webhookCallback } from "grammy";
import { bot } from "@/bot/bot";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = webhookCallback(bot, "std/http", { secretToken: env.TELEGRAM_WEBHOOK_SECRET });
export async function POST(req: Request) {
  return handler(req);
}
```

**Step 5: Commit.**

```bash
git commit -am "feat(bot): grammY webhook route + /start menu"
```

---

### Task D2: Onboarding — upsert user, capture parent code, generate ref code

**Files:**
- Create: `bot/services/onboarding.ts`, `bot/services/onboarding.test.ts`
- Modify: `bot/handlers/start.ts`

**Step 1: Failing test** — for `onboardUser({ tgUserId, tgUsername, lang, startPayload })`:
- New user with valid `startPayload` matching an existing `ref_code` → row created with `parent_ref_code=...`, new `ref_code` issued.
- New user with `startPayload` matching no code → row created, `parent_ref_code=null`.
- New user with no `startPayload` → row created, `parent_ref_code=null`.
- Existing user with a `startPayload` → row unchanged (parent stays locked).
- Self-referral (`startPayload === own ref_code`) → ignored.

Use a Postgres test DB; truncate before each test (helper in `test/db.ts`).

**Step 2-4: Implement** using a transaction:
```
INSERT INTO users (...) ON CONFLICT (tg_user_id) DO NOTHING RETURNING *;
IF inserted AND startPayload matches existing user's ref_code AND that user != self:
    UPDATE users SET parent_ref_code=$payload WHERE id=$new.id AND parent_ref_code IS NULL;
IF users.ref_code IS NULL:
    loop createUniqueRefCode → UPDATE users SET ref_code=$code WHERE id=$ AND ref_code IS NULL;
```

Wire into `start.ts`.

**Step 5: Commit.**

```bash
git commit -am "feat(onboarding): upsert user, lock parent ref, issue own ref code"
```

---

### Task D3: `/buy` lists plans + creates invoice (stub deposit address)

**Files:**
- Create: `bot/handlers/buy.ts`, `bot/services/invoices.ts`, `bot/services/invoices.test.ts`
- Modify: `bot/bot.ts`

**Step 1: Failing test** for `createInvoice({ userId, planId })`:
- Inserts row with `status=pending`, `expires_at = now + 30m`, `amount_usdt = plan.price_usdt`, `deriv_index` = next monotonic counter.
- Throws if plan inactive.
- Sets `deposit_address` to `tron.deriveDepositAddress(deriv_index).address`.

Use the fake Tron.

**Step 2-4:** Implement. Use a Postgres sequence for `deriv_index` (e.g. `CREATE SEQUENCE deriv_index_seq START 1`) — migration added now. Wire `/buy` handler: list active plans as inline buttons; on tap, call `createInvoice` and reply with address + amount + countdown + "I've paid" button.

**Step 5: Commit.**

```bash
git commit -am "feat(buy): plan picker + invoice creation with HD-derived address"
```

---

## Phase E — Payment detection and settlement

### Task E1: `scan-payments` cron — settle invoices, no commissions yet

**Files:**
- Create: `app/api/cron/scan-payments/route.ts`, `lib/settle.ts`, `lib/settle.test.ts`

**Step 1: Failing test** — `settleIfPaid(invoiceId)`:
- Fake Tron is pre-seeded with one confirmed USDT transfer to the invoice's deposit address for the exact amount.
- After call: invoice `status='paid'`, `paid_tx_hash` set, subscription row created with `starts_at=now`, `ends_at=now+30d`.
- Calling twice → no-op on second call (UNIQUE on `paid_tx_hash`).
- Underpayment seed → invoice flagged `has_partial_payment=true`, no subscription created.

**Step 2-4:** Implement with `BEGIN; SELECT ... FOR UPDATE WHERE id=$1 AND status='pending'; UPDATE; INSERT subscription; COMMIT;`. Use `db.transaction(async tx => …)`.

**Step 5: Cron route** — wraps `withLease("scan-payments", 90, …)`; selects up to 200 pending invoices `WHERE expires_at > now() - interval '24 hours'`; for each pulls `listUsdtTransfersTo` and calls `settleIfPaid`.

Add cron auth: every cron route checks `Authorization: Bearer ${env.CRON_SECRET}` header (Vercel Cron sets this). Add `CRON_SECRET` to env loader.

**Step 6: Commit.**

```bash
git commit -am "feat(cron): scan-payments + idempotent settle"
```

---

### Task E2: Channel grant — one-shot invite link

**Files:**
- Create: `bot/services/grant.ts`, `bot/services/grant.test.ts`
- Modify: `lib/settle.ts` (enqueue grant after settle commit)

**Step 1: Failing test** — `grantChannelAccess({ userId, channelId })`:
- Calls `bot.api.createChatInviteLink(channelId, { member_limit: 1, expire_date: nowEpoch + 3600 })`.
- DMs the user the link.
- On Telegram API failure, throws (caller retries on next cron tick).

Mock `bot.api`.

**Step 2-4:** Implement. Call after `settleIfPaid` returns success — but **outside** the DB transaction (use a `postCommitTasks` array returned from `settleIfPaid`, flushed by the caller).

**Step 5: Commit.**

```bash
git commit -am "feat(grant): one-shot invite link + DM after settlement"
```

---

## Phase F — Commissions

### Task F1: Commission accrual

**Files:**
- Create: `lib/commissions.ts`, `lib/commissions.test.ts`
- Modify: `lib/settle.ts` (call accrual inside settlement TX)

**Step 1: Failing tests** (run all in one file):
- Buyer with no parent → no ledger rows.
- Buyer with L1 only → 1 row, level=1, `amount = price * tier_bps / 10000`, tier chosen on lifetime count excluding current invoice.
- Buyer with L1 and L2 → 2 rows, L2 `basis = L1.amount`, `amount = L1.amount * cfg.l2_bps / 10000`.
- Tier upgrade case: seed 9 prior paid invoices for L1 → this 10th still at `<10` tier (10 not yet reached); seed 10 prior → this 11th at `≥10`.
- `unlock_at = paid_at` when `payout_mode='instant'`; `unlock_at = paid_at + N days` when `'deferred'`.
- Calling twice → second insert blocked by UNIQUE `(invoice_id, beneficiary_id, level)`.

**Step 2-4:** Implement per design §5.6. Use one SQL query for tier count.

**Step 5: Wire into `lib/settle.ts`** inside the same transaction.

**Step 6: Commit.**

```bash
git commit -am "feat(commissions): 2-level cascading accrual with frozen rates"
```

---

### Task F2: Payout queue cron

**Files:**
- Create: `app/api/cron/payout-queue/route.ts`, `lib/payouts.ts`, `lib/payouts.test.ts`

**Step 1: Failing tests:**
- Promotion: rows with `status='accrued' AND unlock_at <= now()` move to `payable`.
- Batching: per-beneficiary sum ≥ `min_payout_usdt` triggers a batch; below threshold leaves rows in `payable`.
- Skip when `payout_address IS NULL`.
- Skip when `payout_address_changed_at < 24h ago`.
- `MAX_PAYOUT_PER_TX_USDT` breach → batch not broadcast; `ops_kill_switch.payout_disabled` set; admin alert recorded (via stub).
- `MAX_PAYOUTS_PER_HOUR` breach → no broadcast, same effect.
- Concurrent tick: simulate two parallel calls; assert no double-pay using `FOR UPDATE SKIP LOCKED`. (Run on real Postgres in the test.)
- Successful broadcast: `payout_batches.tx_hash` set, status `broadcast`; ledger rows status `paid`, `paid_tx_hash` set.

**Step 2-4:** Implement per design §5.7. The TRON send call happens **after commit** of the batch row creation + ledger updates; the broadcast tx hash is updated in a second small TX.

**Step 5: Cron route** with `withLease`, auth, and 5-min schedule.

**Step 6: Commit.**

```bash
git commit -am "feat(payouts): batched payout cron with row-locks and breakers"
```

---

## Phase G — Expiry, renewal, sweep

### Task G1: Expire-access cron — soft kick + nudges

**Files:**
- Create: `app/api/cron/expire-access/route.ts`, `lib/expiry.ts`, `lib/expiry.test.ts`

**Step 1: Failing tests:**
- Nudge at T-72h, T-24h, T-1h: each fires exactly once (idempotent via `nudges_sent`).
- Hard expiry: ban + unban via mocked `bot.api`; subscription `status='expired'`; user DM'd.
- `banChatMember` failing → row stays `active`, error recorded.
- Already-expired subscriptions are not processed twice.
- Lost-admin scenario (Telegram returns "not enough rights") → row stays active, alert recorded.

**Step 2-4:** Implement per design §5.5 with `FOR UPDATE SKIP LOCKED` over a 200-row batch.

**Step 5: Commit.**

```bash
git commit -am "feat(cron): expire-access with nudges + soft kick"
```

---

### Task G2: `/renew` handler

**Files:**
- Create: `bot/handlers/renew.ts`, `bot/handlers/renew.test.ts`
- Modify: `lib/settle.ts` (use stacking rule for active subs; new-from-now for expired)

**Step 1: Failing tests:**
- Active sub renewed → new sub's `starts_at = old.ends_at`, `ends_at = old.ends_at + plan.duration_days`. Old sub remains active until its `ends_at`.
- Expired sub renewed → new sub's `starts_at = now()` (grace = 0 per locked decision).
- Renewal payment accrues commissions normally (regression test against any "first-invoice-only" guard).

**Step 2-4:** Implement. Stacking is computed when creating the **subscription row** inside `settleIfPaid`, not at invoice creation, because we want the most recent state at settlement time.

**Step 5: Commit.**

```bash
git commit -am "feat(renew): /renew handler + stacking rule for active subs"
```

---

### Task G3: Sweep cron

**Files:**
- Create: `app/api/cron/sweep/route.ts`, `lib/sweep.ts`, `lib/sweep.test.ts`

**Step 1: Failing tests:**
- Paid invoice older than 15m with positive USDT balance → sweep tx fired; `swept=true`, `sweep_tx_hash` set.
- Insufficient TRX on deposit address → TRX top-up tx fired first.
- Zero balance → `swept=true`, no tx fired.
- Idempotency: second run skips already-swept rows (`AND swept=false`).

Use fake Tron.

**Step 2-4:** Implement per design §5.9, batched 100 per tick.

**Step 5: Commit.**

```bash
git commit -am "feat(cron): sweep with just-in-time TRX top-up"
```

---

## Phase H — Referrer dashboard

### Task H1: Earnings + My Referrals queries

**Files:**
- Create: `bot/services/dashboard.ts`, `bot/services/dashboard.test.ts`

**Step 1: Failing tests** for these functions:
- `getReferralStats(userId)` → `{ l1Count, l1LifetimePaid, l1Tier, nextTier, l2Count, l2LifetimePaid }`.
- `getEarningsSummary(userId)` → `{ paidUsdt, payableUsdt, pendingUsdt, lifetimeUsdt, byLevel30d: { l1, l2 }, recentPayouts: [...] }`.

Seed a small graph: A → B → C, with several paid invoices, and assert numbers exactly.

**Step 2-4:** Implement with SQL — each is a single grouped query.

**Step 5: Commit.**

```bash
git commit -am "feat(dashboard): referral stats + earnings summary queries"
```

---

### Task H2: Dashboard handlers in the bot

**Files:**
- Create: `bot/handlers/my_referrals.ts`, `bot/handlers/earnings.ts`, `bot/handlers/payout_address.ts`, `bot/handlers/withdraw_now.ts`
- Modify: `bot/bot.ts`

**Step 1: Failing tests** for handlers — render templates with the dashboard data, assert exact strings (so regressions show up).

**Step 2-4:** Implement.

- `payout_address` flow: ask for address → validate (T-prefix, 34 chars, TRON base58check via `tronweb.isAddress`) → save `payout_address` and bump `payout_address_changed_at`.
- `withdraw_now` button: calls a one-beneficiary version of payout-queue logic, debounced via KV `withdraw:<userId>` 60s lockout, requires `payable >= min_payout_usdt`.

**Step 5: Commit.**

```bash
git commit -am "feat(bot): my referrals + earnings + payout address + withdraw now"
```

---

## Phase I — Admin, refund, ops

### Task I1: Admin gate + bot `/admin` read-only

**Files:**
- Create: `bot/middleware/admin_only.ts`, `bot/handlers/admin_stats.ts`, `bot/handlers/admin_stats.test.ts`
- Modify: `bot/bot.ts`

**Step 1: Failing test** — non-admin caller is ignored; admin caller gets stats text (today's paid invoices, today's accrued commissions, hot wallet balances).

**Step 2-4:** Implement; the gate checks `ctx.from.id` against `env.ADMIN_TG_IDS`.

**Step 5: Commit.**

```bash
git commit -am "feat(admin): /admin stats gated by ADMIN_TG_IDS"
```

---

### Task I2: Admin web pages

**Files:**
- Create: `app/admin/page.tsx`, `app/admin/refund/[invoiceId]/page.tsx`, `app/api/admin/refund/route.ts`, `app/api/admin/kill-switch/route.ts`, `app/api/admin/commission-config/route.ts`, `lib/admin-auth.ts`, `lib/admin-auth.test.ts`

**Step 1: Failing test** for `lib/admin-auth.ts`:
- Request without admin session cookie → rejected.
- Cookie valid + TOTP code wrong → rejected.
- Cookie valid + TOTP correct → accepted.

**Step 2-4:** Implement. Session = signed cookie containing `{ tgUserId, iat }`, signed with an `ADMIN_COOKIE_SECRET` env var. Session is created by a Telegram-Login-style flow: admin clicks "Login as admin" in bot DM → bot sends them a one-time URL with a short-lived signed token → server sets the cookie. TOTP via `otplib` (`ADMIN_TOTP_SECRET_<tgUserId>` env vars).

Admin pages live under `app/admin/*`. The kill-switch toggle, commission-config editor, and refund initiator each go through `lib/admin-auth.requireAdmin(request, totp)`.

**Step 5: Refund route** — accepts `{ invoiceId, refundToAddress }`, validates, writes a `refund_intents` row, broadcasts USDT from hot wallet (re-using `tron.sendUsdt`), writes negative ledger rows per design §5.8, revokes subscription, and kicks the user. All as one DB TX + post-commit TRON broadcast.

**Step 6: Commit.**

```bash
git commit -am "feat(admin): web pages, TOTP gate, refund + kill switch + config editor"
```

---

### Task I3: Circuit breakers + kill switch enforcement

**Files:**
- Create: `lib/breakers.ts`, `lib/breakers.test.ts`
- Modify: `bot/handlers/buy.ts`, `app/api/cron/payout-queue/route.ts`, `lib/payouts.ts`

**Step 1: Failing tests:**
- `/buy` blocked when `ops_kill_switch.buy_disabled = true`.
- Payout cron no-op when `payout_disabled`.
- `MAX_PAYOUT_PER_TX_USDT` triggers kill switch + admin DM.
- `MAX_PAYOUTS_PER_HOUR` (KV sliding-window) triggers kill switch + admin DM.

**Step 2-4:** Implement.

**Step 5: Commit.**

```bash
git commit -am "feat(ops): circuit breakers + kill-switch enforcement"
```

---

## Phase J — Observability and deploy

### Task J1: Structured logging + Sentry

**Files:**
- Create: `lib/log.ts`
- Modify: every route to log start/end with `route`, `latency_ms`, `outcome`.
- Create: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` (only `server` will fire on Vercel functions).

**Step 1:** Pino logger with JSON output and redaction list (`paid_tx_hash` is fine to log; `TRON_*_PK`, `TELEGRAM_BOT_TOKEN`, anything under `body.text` is redacted).

**Step 2:** Wire Sentry per Next.js docs; tag spans with `route` and `cron_route`.

**Step 3:** Commit.

```bash
git commit -am "feat(obs): pino + sentry with redaction"
```

---

### Task J2: Health endpoint

**Files:**
- Create: `app/api/health/route.ts`, `app/api/health/route.test.ts`

**Step 1: Failing test** — returns `200` with `{ status: 'ok', cronTicks: {...}, hotWalletUsdt, hotWalletTrx, pendingInvoices, killSwitch }`; returns `503` if any cron last-tick is older than 5 min.

**Step 2-4:** Implement. Store cron last-tick timestamps in KV at end of each cron route (`SET cron:tick:<name> <iso>`).

**Step 5: Commit.**

```bash
git commit -am "feat(health): /api/health with cron freshness + balances"
```

---

### Task J3: `vercel.json` cron config

**Files:**
- Create: `vercel.json`

**Step 1:**

```json
{
  "crons": [
    { "path": "/api/cron/scan-payments",  "schedule": "*/1 * * * *" },
    { "path": "/api/cron/expire-access",  "schedule": "*/1 * * * *" },
    { "path": "/api/cron/payout-queue",   "schedule": "*/5 * * * *" },
    { "path": "/api/cron/sweep",          "schedule": "*/10 * * * *" }
  ]
}
```

(Vercel cron minimum interval is 1 minute on Pro; the design's 30s scan target is approximated by 1-minute cron + the "I've paid" manual scan button.)

**Step 2: Commit.**

```bash
git commit -am "chore(vercel): cron schedule"
```

---

### Task J4: Telegram webhook setup script

**Files:**
- Create: `scripts/setup-telegram-webhook.ts`

**Step 1:** Script that calls `setWebhook` with the production URL + secret token. Runnable via `npx tsx scripts/setup-telegram-webhook.ts`.

**Step 2: Commit.**

```bash
git commit -am "chore: telegram webhook setup script"
```

---

## Phase K — End-to-end verification

### Task K1: Nile-testnet smoke test

**Files:**
- Create: `scripts/e2e-nile.ts`, `docs/runbook.md` (verification checklist)

**Step 1:** Manual procedure: provision dev DB, set env vars to Nile, run migrations + seed, set Telegram webhook to a tunneled URL (use ngrok), execute a full buy → settle → grant → renew → payout → sweep cycle with one L1 and one L2 referrer. Document every step.

**Step 2:** Use the procedure once; capture screenshots/tx hashes in `runbook.md`. **No code claims success without this run.** Per `superpowers:verification-before-completion`, you ran the verification and observed the output.

**Step 3: Commit.**

```bash
git commit -am "chore(runbook): nile testnet smoke procedure"
```

---

### Task K2: Production rollout checklist

**Files:**
- Modify: `docs/runbook.md`

Add a checklist:
- [ ] Cold wallet created offline; address recorded.
- [ ] Hot wallet funded with ≥ 2 days of expected commission USDT + 100 TRX for sweep top-ups.
- [ ] Deposit xprv generated offline; only the encrypted form stored in Vercel env (`TRON_DEPOSIT_XPRV`).
- [ ] Bot promoted to admin in target channel with `invite users` and `ban users` rights.
- [ ] `DEFAULT_CHANNEL_ID` matches the channel.
- [ ] `commission_config` reviewed in admin UI.
- [ ] `ops_kill_switch` is `false`/`false`.
- [ ] Sentry receiving events; Logtail receiving events.
- [ ] `/api/health` returns 200; external uptime monitor configured.
- [ ] `MAX_PAYOUT_PER_TX_USDT` and `MAX_PAYOUTS_PER_HOUR` set to sane defaults.
- [ ] `ADMIN_TG_IDS` set; admin web login flow tested.

Final commit:

```bash
git commit -am "chore(runbook): production rollout checklist"
```

---

## Wrap-up notes for the executor

- After Task E1 you have a functioning subscription bot. Everything beyond adds referral mechanics, ops, and safety. If timeline pressure hits, ship Phase A→E first.
- After Task F2 the bot is feature-complete for v1.
- Phase I (admin) is the smallest amount of code you can write that keeps you safe in production. Don't skip it.
- Do not skip Task K1 before going live. The runbook tx-hashes are your proof the system actually moves money.
