/**
 * TEMPORARY: creates a full test referral scenario in DB.
 * DELETE AFTER USE.
 * 
 * GET /api/test-scenario
 */
import { getDb } from "@/db/client";
import {
  users,
  invoices,
  subscriptions,
  subscriptionPlans,
  commissionConfig,
  commissionLedger,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const lines: string[] = [];

  try {
    // 1. Find admin
    const admin = await db
      .select()
      .from(users)
      .where(eq(users.tgUserId, BigInt(607645943)))
      .limit(1)
      .then((r) => r[0]);
    if (!admin) throw new Error("Admin not found");
    lines.push(`Admin: refCode=${admin.refCode} role=${admin.role} vipBps=${admin.vipBps}`);

    // 2. Create test user (referral)
    const testRefCode = "TST" + Date.now().toString(36).toUpperCase().slice(-6);
    const [testUser] = await db
      .insert(users)
      .values({
        tgUserId: BigInt(999999999),
        tgUsername: "test_ref_user",
        refCode: testRefCode,
        parentRefCode: admin.refCode,
        role: "regular",
      })
      .returning();
    lines.push(`Test user created: refCode=${testRefCode}, parent=${admin.refCode}`);

    // 3. Get plan 1 (1 USDT / 1 year)
    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, 1))
      .limit(1)
      .then((r) => r[0]);
    if (!plan) throw new Error("Plan 1 not found");
    lines.push(`Plan: ${plan.name} ${plan.priceUsdt} USDT ${plan.durationDays}d`);

    // 4. Create invoice + subscription
    const tron = getTron();
    const [seq] = await db
      .select({ n: sql<number>`nextval('deriv_index_seq')` })
      .from(sql`(SELECT 1)`);
    const idx = Number(seq.n);
    const { address } = tron.deriveDepositAddress(idx);

    const [inv] = await db
      .insert(invoices)
      .values({
        userId: testUser.id,
        planId: 1,
        depositAddress: address,
        derivIndex: idx,
        amountUsdt: "1.000000",
        status: "paid",
        expiresAt: new Date(Date.now() + 3_600_000),
        paidAt: new Date(),
        paidTxHash: "test_scenario_" + Date.now().toString(36),
      })
      .returning();
    lines.push(`Invoice: ${inv.id.slice(0, 8)} 1.0 USDT → ${address.slice(0, 12)}...`);

    const [sub] = await db
      .insert(subscriptions)
      .values({
        userId: testUser.id,
        invoiceId: inv.id,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + plan.durationDays * 86_400_000),
        channelId: getEnv().DEFAULT_CHANNEL_ID,
        status: "active",
      })
      .returning();
    lines.push(`Subscription: ${sub.id.slice(0, 8)} active ${plan.durationDays}d`);

    // 5. Accrue commission
    const vipBps = admin.vipBps ?? 5000;
    await db
      .insert(commissionLedger)
      .values({
        invoiceId: inv.id,
        beneficiaryId: admin.id,
        level: 1,
        basisUsdt: "1.000000",
        rateBps: vipBps,
        amountUsdt: "0.500000",
        unlockAt: new Date(),
        status: "accrued",
      })
      .catch(() => {}); // ignore duplicate
    lines.push(`Commission accrued: 0.500000 USDT (${vipBps} bps) → admin`);

    return Response.json({ ok: true, results: lines });
  } catch (err) {
    return Response.json({ ok: false, error: String(err).slice(0, 500) });
  }
}
