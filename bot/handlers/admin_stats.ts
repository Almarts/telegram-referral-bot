import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { invoices, commissionLedger, opsKillSwitch } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { getTron } from "@/lib/tron";

export async function handleAdminStats(ctx: Context): Promise<void> {
  const db = getDb();
  const tron = getTron();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // All reads are independent — run them concurrently.
  const hotSigner = tron.hotSigner();
  const [paidToday, commissionsToday, hotUsdt, hotTrxSun, ks] = await Promise.all([
    // Today's paid invoices
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.status, "paid"), gte(invoices.paidAt, today)))
      .then((r) => r[0]?.count ?? 0),
    // Today's accrued commissions
    db
      .select({
        total: sql<string>`coalesce(sum(${commissionLedger.amountUsdt}), '0')`,
      })
      .from(commissionLedger)
      .where(gte(commissionLedger.unlockAt, today))
      .then((r) => r[0]?.total ?? "0"),
    // Hot wallet balances
    tron.usdtBalance(hotSigner.address),
    tron.trxBalanceSun(hotSigner.address),
    // Kill switch status
    db
      .select()
      .from(opsKillSwitch)
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const lines = [
    "Admin Stats",
    "",
    `Paid invoices today: ${paidToday}`,
    `Commissions accrued today: ${commissionsToday} USDT`,
    "",
    "Hot wallet:",
    `  USDT: ${hotUsdt}`,
    `  TRX: ${hotTrxSun} SUN`,
    "",
    "Kill switch:",
    `  Buy disabled: ${ks?.buyDisabled ? "YES" : "no"}`,
    `  Payout disabled: ${ks?.payoutDisabled ? "YES" : "no"}`,
  ];

  if (ks?.reason) {
    lines.push(`  Reason: ${ks.reason}`);
  }

  await ctx.reply(lines.join("\n"));
}
