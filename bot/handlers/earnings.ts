import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEarningsSummary } from "@/bot/services/dashboard";

export async function handleEarnings(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const db = getDb();
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await ctx.reply("Please /start the bot first.");
    return;
  }

  const summary = await getEarningsSummary(user.id);

  const lines = [
    "Earnings",
    "",
    `Paid: ${summary.paidUsdt} USDT`,
    `Available (payable): ${summary.payableUsdt} USDT`,
    `Pending: ${summary.accruedUsdt} USDT`,
    `Lifetime: ${summary.lifetimeUsdt} USDT`,
    "",
    "Last 30 days:",
    `  L1: ${summary.byLevel30d.l1} USDT`,
    `  L2: ${summary.byLevel30d.l2} USDT`,
  ];

  if (summary.recentPayouts.length > 0) {
    lines.push("", "Recent payouts:");
    for (const p of summary.recentPayouts.slice(0, 3)) {
      const hash = p.txHash ? `${p.txHash.slice(0, 10)}...` : "pending";
      lines.push(`  ${p.amountUsdt} USDT — ${hash}`);
    }
  }

  await ctx.reply(lines.join("\n"));
}
