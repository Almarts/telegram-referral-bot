/**
 * Migration: set 2 USDT tariffs.
 *   id=1: "3 Months"  — 90 days,  120.000000 USDT
 *   id=2: "1 Year"    — 365 days, 400.000000 USDT
 * Deactivate everything else.
 *
 * Payments are received in USDT (TRC20) per settle.ts.
 *
 * Run: DATABASE_URL=... npx tsx scripts/setup-plans.ts
 */
import { getDb } from "../db/client";
import { subscriptionPlans } from "../db/schema";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();

  // 1. Deactivate all existing plans
  await db.update(subscriptionPlans).set({ active: false }).where(sql`1=1`);
  console.log("Deactivated all existing plans");

  // 2. Upsert plan id=1: 3 Months — 120 USDT
  await db
    .insert(subscriptionPlans)
    .values({
      id: 1,
      name: "3 Months",
      durationDays: 90,
      priceUsdt: "120.000000",
      currency: "USDT",
      active: true,
    })
    .onConflictDoUpdate({
      target: subscriptionPlans.id,
      set: {
        name: "3 Months",
        durationDays: 90,
        priceUsdt: "120.000000",
        currency: "USDT",
        active: true,
      },
    });
  console.log("Set plan id=1: 3 Months / 120 USDT");

  // 3. Upsert plan id=2: 1 Year — 400 USDT
  await db
    .insert(subscriptionPlans)
    .values({
      id: 2,
      name: "1 Year",
      durationDays: 365,
      priceUsdt: "400.000000",
      currency: "USDT",
      active: true,
    })
    .onConflictDoUpdate({
      target: subscriptionPlans.id,
      set: {
        name: "1 Year",
        durationDays: 365,
        priceUsdt: "400.000000",
        currency: "USDT",
        active: true,
      },
    });
  console.log("Set plan id=2: 1 Year / 400 USDT");

  console.log("✅ Done");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
