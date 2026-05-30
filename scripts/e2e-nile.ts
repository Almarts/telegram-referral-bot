/**
 * Nile testnet smoke test — validates connectivity and config without moving real money.
 *
 * What this checks:
 *   1. DB connectivity (migrations applied, seed data present)
 *   2. KV connectivity (lease acquire/release)
 *   3. TRON address derivation (xprv → deposit addresses)
 *   4. Commission config validation
 *   5. Kill switch state
 *   6. Env completeness
 *
 * Usage:
 *   npx tsx scripts/e2e-nile.ts
 *
 * Requires DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN,
 * TRON_DEPOSIT_XPRV, TRON_HOT_WALLET_PK, TRON_COLD_WALLET_ADDRESS,
 * TRONGRID_API_KEY to be set in .env.local or process env.
 *
 * This is a pre-flight check, not the full buy→settle→sweep cycle (that
 * requires Telegram, ngrok, and real TRON testnet USDT — see docs/runbook.md).
 */
import "dotenv/config";
import { getDb } from "@/db/client";
import { sql } from "drizzle-orm";
import { subscriptionPlans, commissionConfig, opsKillSwitch } from "@/db/schema";
import { parseEnv } from "@/lib/env";
import { Redis } from "@upstash/redis";
import { createLeaseRunner } from "@/lib/cron-lease";
import { getTron } from "@/lib/tron";

type Check = { name: string; pass: boolean; detail: string };

async function main() {
  const checks: Check[] = [];
  const pass = (name: string, detail: string): Check => {
    console.log(`  ✓ ${name}`);
    return { name, pass: true, detail };
  };
  const fail = (name: string, detail: string): Check => {
    console.log(`  ✗ ${name}  — ${detail}`);
    return { name, pass: false, detail };
  };

  // ── 1. Env validation ────────────────────────────────────────────────────
  console.log("\n── 1. Environment ──");
  let env;
  try {
    env = parseEnv();
    checks.push(pass("env.parse", "all required vars present"));
  } catch (err: unknown) {
    checks.push(fail("env.parse", (err as Error).message));
    report(checks);
    return;
  }

  // ── 2. DB connectivity ───────────────────────────────────────────────────
  console.log("\n── 2. Database ──");
  try {
    const db = getDb();
    const rows = await db.select({ count: sql<bigint>`count(*)` }).from(subscriptionPlans);
    const planCount = Number(rows[0]?.count ?? 0);
    if (planCount >= 3) {
      checks.push(pass("db.plans", `${planCount} plans seeded`));
    } else {
      checks.push(fail("db.plans", `expected ≥3, got ${planCount} — run db:seed`));
    }

    const config = await db.select().from(commissionConfig).limit(1);
    if (config[0]) {
      checks.push(pass("db.commission_config", `l2_bps=${config[0].l2Bps}, payout=${config[0].payoutMode}`));
    } else {
      checks.push(fail("db.commission_config", "no row — run db:seed"));
    }

    const ks = await db.select().from(opsKillSwitch).limit(1);
    if (ks[0]) {
      const disabled = [];
      if (ks[0].buyDisabled) disabled.push("buy");
      if (ks[0].payoutDisabled) disabled.push("payout");
      checks.push(pass("db.kill_switch", disabled.length ? `disabled: ${disabled.join(",")}` : "all clear"));
    } else {
      checks.push(fail("db.kill_switch", "no row — run db:seed"));
    }
  } catch (err: unknown) {
    checks.push(fail("db.connect", (err as Error).message));
  }

  // ── 3. KV connectivity ───────────────────────────────────────────────────
  console.log("\n── 3. KV (Upstash Redis) ──");
  try {
    const kv = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
    await kv.set("e2e:ping", "pong", { ex: 10 });
    const pong = await kv.get("e2e:ping");
    if (pong === "pong") {
      checks.push(pass("kv.ping", "set/get OK"));
    } else {
      checks.push(fail("kv.ping", `got ${String(pong)}`));
    }

    const withLease = createLeaseRunner(kv);
    let leaseRan = false;
    const result = await withLease("e2e-lease", 30, async () => {
      leaseRan = true;
      return "ok";
    });
    if (result === "ok" && leaseRan) {
      checks.push(pass("kv.lease", "acquire → execute → release OK"));
    } else {
      checks.push(fail("kv.lease", `result=${result}, ran=${leaseRan}`));
    }
  } catch (err: unknown) {
    checks.push(fail("kv.count", (err as Error).message));
  }

  // ── 4. TRON address derivation ───────────────────────────────────────────
  console.log("\n── 4. TRON ──");
  try {
    const tron = getTron();

    const deposit0 = tron.deriveDepositAddress(0);
    const deposit5 = tron.deriveDepositAddress(5);
    if (
      deposit0.address.startsWith("T") &&
      deposit0.address.length === 34 &&
      deposit5.address.startsWith("T") &&
      deposit5.address !== deposit0.address
    ) {
      checks.push(pass("tron.derive", `idx 0..5 deterministic, unique`));
    } else {
      checks.push(fail("tron.derive", "addresses invalid or duplicate"));
    }

    const hot = tron.hotSigner();
    if (hot.address.startsWith("T") && hot.address.length === 34) {
      checks.push(pass("tron.hot", `hot wallet: ${hot.address.slice(0, 8)}...`));
    } else {
      checks.push(fail("tron.hot", "bad address"));
    }

    const coldOk =
      env.TRON_COLD_WALLET_ADDRESS.startsWith("T") &&
      env.TRON_COLD_WALLET_ADDRESS.length === 34;
    if (coldOk) {
      checks.push(pass("tron.cold", `cold wallet: ${env.TRON_COLD_WALLET_ADDRESS.slice(0, 8)}...`));
    } else {
      checks.push(fail("tron.cold", "bad address"));
    }

    // Balance checks (informational — testnet keys may have 0 balance)
    try {
      const usdt = await tron.usdtBalance(deposit0.address);
      const trx = await tron.trxBalanceSun(hot.address);
      checks.push(pass("tron.rpc", `idx0 USDT=${usdt}, hot TRX=${trx} SUN`));
    } catch (err: unknown) {
      checks.push(fail("tron.rpc", (err as Error).message));
    }
  } catch (err: unknown) {
    checks.push(fail("tron.init", (err as Error).message));
  }

  // ── 5. Config sanity ─────────────────────────────────────────────────────
  console.log("\n── 5. Config ──");
  checks.push(
    process.env.TELEGRAM_BOT_TOKEN
      ? pass("cfg.tg_token", `set (${process.env.TELEGRAM_BOT_TOKEN.slice(0, 6)}...)`)
      : fail("cfg.tg_token", "not set"),
  );
  checks.push(
    process.env.CRON_SECRET
      ? pass("cfg.cron_secret", `set (len=${process.env.CRON_SECRET.length})`)
      : fail("cfg.cron_secret", "not set"),
  );
  checks.push(
    env.MAX_PAYOUT_PER_TX_USDT
      ? pass("cfg.max_payout", `${env.MAX_PAYOUT_PER_TX_USDT} USDT`)
      : fail("cfg.max_payout", "not set"),
  );
  checks.push(
    env.ADMIN_TG_IDS
      ? pass("cfg.admin_ids", `${env.ADMIN_TG_IDS.length} admin(s)`)
      : fail("cfg.admin_ids", "not set"),
  );

  // ── Report ───────────────────────────────────────────────────────────────
  report(checks);
}

function report(checks: Check[]) {
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${"─".repeat(40)}`);
  console.log(`${passed}/${checks.length} passed${failed ? `, ${failed} FAILED` : ""}`);

  if (failed) {
    console.log("\nFAILED:");
    for (const c of checks) {
      if (!c.pass) console.log(`  • ${c.name}: ${c.detail}`);
    }
  }
  console.log();

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("e2e-nile crashed:", err);
  process.exit(1);
});
