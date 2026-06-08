import type { Context } from "grammy";
import { getDb } from "@/db/client";
import {
  invoices,
  commissionLedger,
  payoutBatches,
  commissionConfig,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export async function handleFinance(ctx: Context): Promise<void> {
  const db = getDb();
  const tron = getTron();
  const hotSigner = tron.hotSigner();
  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;

  const [totalPaid, totalCommissions, totalPayouts, pendingPayouts, hotUsdt, hotTrx, coldUsdt, pendingSweep, config] =
    await Promise.all([
      // Total USDT collected (all paid invoices)
      db
        .select({
          total: sql<string>`coalesce(sum(${invoices.amountUsdt}), '0')`,
        })
        .from(invoices)
        .where(eq(invoices.status, "paid"))
        .then((r) => r[0]?.total ?? "0"),

      // Total commissions accrued
      db
        .select({
          total: sql<string>`coalesce(sum(${commissionLedger.amountUsdt}), '0')`,
        })
        .from(commissionLedger)
        .where(
          and(
            eq(commissionLedger.status, "accrued"),
            sql`${commissionLedger.unlockAt} <= now()`,
          ),
        )
        .then((r) => r[0]?.total ?? "0"),

      // Total commissions paid out
      db
        .select({
          total: sql<string>`coalesce(sum(${commissionLedger.amountUsdt}), '0')`,
        })
        .from(commissionLedger)
        .where(eq(commissionLedger.status, "paid"))
        .then((r) => r[0]?.total ?? "0"),

      // Pending payouts (payable but not yet paid)
      db
        .select({
          total: sql<string>`coalesce(sum(${commissionLedger.amountUsdt}), '0')`,
          count: sql<number>`count(*)::int`,
        })
        .from(commissionLedger)
        .where(eq(commissionLedger.status, "payable"))
        .then((r) => r[0] ?? { total: "0", count: 0 }),

      // Hot wallet balances
      tron.usdtBalance(hotSigner.address),
      tron.trxBalanceSun(hotSigner.address),

      // Cold wallet USDT balance
      tron.usdtBalance(coldAddress).catch(() => "error"),

      // Invoices paid but not yet swept
      db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${invoices.amountUsdt}), '0')`,
        })
        .from(invoices)
        .where(and(eq(invoices.status, "paid"), eq(invoices.swept, false)))
        .then((r) => r[0] ?? { count: 0, total: "0" }),

      // Commission config (min payout, defer days)
      db
        .select({
          minPayoutUsdt: commissionConfig.minPayoutUsdt,
          payoutMode: commissionConfig.payoutMode,
          deferDays: commissionConfig.deferDays,
        })
        .from(commissionConfig)
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

  const lines: string[] = ["💰 *Finance*", ""];

  lines.push("*Revenue:*");
  lines.push(`  Collected (all time): *${totalPaid} USDT*`);

  lines.push("");
  lines.push("*Commissions:*");
  lines.push(`  Available to pay: *${pendingPayouts.total} USDT* (${pendingPayouts.count} rows)`);
  lines.push(`  Paid out: *${totalPaidOut} USDT*`);

  lines.push("");
  lines.push("*Hot wallet:*");
  lines.push(`  USDT: *${hotUsdt}*`);
  lines.push(`  TRX: *${hotTrx} SUN*`);

  lines.push("");

  if (coldUsdt !== "error") {
    lines.push("*Cold wallet:*");
    lines.push(`  USDT: *${coldUsdt}*`);
  } else {
    lines.push("*Cold wallet:* failed to fetch");
  }

  lines.push("");
  lines.push("*Pending sweep:*");
  lines.push(`  ${pendingSweep.count} invoices (${pendingSweep.total} USDT)`);

  if (config) {
    lines.push("");
    lines.push("*Config:*");
    lines.push(`  Min payout: ${config.minPayoutUsdt} USDT`);
    lines.push(`  Defer: ${config.deferDays}d`);
    lines.push(`  Mode: ${config.payoutMode}`);
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}
