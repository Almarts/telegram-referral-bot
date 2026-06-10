import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users, commissionConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEarningsSummary } from "@/bot/services/dashboard";
import { gte } from "@/lib/money";

export async function handleWithdrawNow(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const db = getDb();
  const user = await db
    .select({
      id: users.id,
      payoutAddress: users.payoutAddress,
      payoutAddressChangedAt: users.payoutAddressChangedAt,
    })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await ctx.reply("Please /start the bot first.");
    return;
  }

  if (!user.payoutAddress) {
    await ctx.reply("Please set your payout address first: /set_payout_address");
    return;
  }

  const summary = await getEarningsSummary(user.id);

  // Load min_payout_usdt threshold
  const cfg = await db
    .select({ minPayoutUsdt: commissionConfig.minPayoutUsdt })
    .from(commissionConfig)
    .limit(1)
    .then((r) => r[0] ?? null);

  const minPayout = cfg?.minPayoutUsdt ?? "50.000000";

  if (!gte(summary.payableUsdt, minPayout)) {
    await ctx.reply(
      [
        `Your available balance (${summary.payableUsdt} USDT) is below the minimum payout threshold (${minPayout} USDT).`,
        "",
        `Payouts are processed automatically when your balance reaches ${minPayout} USDT.`,
      ].join("\n"),
    );
    return;
  }

  // Show status — actual payout is handled by the payout-queue cron
  const wdText = [
    `Available for withdrawal: ${summary.payableUsdt} USDT`,
    `Lifetime earned: ${summary.lifetimeUsdt} USDT`,
    "",
    "Your payout will be processed automatically by the next payout cycle.",
    `Payouts are batched and sent every 5 minutes.`,
    "",
    `Payout address: ${user.payoutAddress}`,
  ].join("\n");

  await ctx.reply(wdText, {
    parse_mode: "Markdown",
  }).catch(async (err) => {
    console.error("handleWithdrawNow: Markdown failed:", err.message);
    await ctx.reply(wdText.replace(/\*/g, ""));
  });
}
