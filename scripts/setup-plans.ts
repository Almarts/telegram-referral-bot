/**
 * Migration: set yearly 1 USDT plan, remove others, zero min payout.
 *
 * Run: npx tsx scripts/setup-plans.ts
 */
import { getDb } from "../db/client";
import { subscriptionPlans, commissionConfig } from "../db/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  const db = getDb();

  // 1. Deactivate all existing plans
  await db
    .update(subscriptionPlans)
    .set({ active: false })
    .where(sql`1=1`);
  console.log("Deactivated all existing plans");

  // 2. Upsert plan id=1 as "1 Year Access" — 365 days, 1.000000 USDT
  await db
    .insert(subscriptionPlans)
    .values({
      id: 1,
      name: "1 Year Access",
      durationDays: 365,
      priceUsdt: "1.000000",
      active: true,
    })
    .onConflictDoUpdate({
      target: subscriptionPlans.id,
      set: {
        name: "1 Year Access",
        durationDays: 365,
        priceUsdt: "1.000000",
        active: true,
      },
    });
  console.log("Set plan id=1: 1 Year / 1 USDT");

  // 3. Set min payout to 0.000001 (lowest possible — effectively zero)
  //    numeric(18,6) can't be 0 in schema, so we use 0.000001
  await db
    .update(commissionConfig)
    .set({ minPayoutUsdt: "0.000001" })
    .where(eq(commissionConfig.id, 1));
  console.log("Set minPayoutUsdt to 0.000001 (effectively zero)");

  console.log("✅ Done");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
