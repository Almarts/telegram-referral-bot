import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getReferralStats } from "@/bot/services/dashboard";

export async function handleMyReferrals(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  try {
    const db = getDb();
    const user = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tgUserId, BigInt(tgUser.id)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!user) {
      await ctx.reply("My referrals\n\nNo account found. Start the bot first.");
      return;
    }

    const stats = await getReferralStats(user.id);

    let msg = "My referrals\n\n";
    msg += `Direct (L1): ${stats.l1Count} users\n`;
    msg += `L1 paid invoices: ${stats.l1LifetimePaid}\n`;
    msg += `Commission: ${stats.l1TierBps / 100}%\n`;
    if (stats.nextTier) {
      msg += `Next tier: ${stats.nextTier.bps / 100}% at ${stats.nextTier.min} paid L1 invoices\n`;
    }
    if (stats.l2Count > 0) {
      msg += `\nIndirect (L2): ${stats.l2Count} users\n`;
      msg += `L2 paid invoices: ${stats.l2LifetimePaid}\n`;
    }

    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply("My referrals\n\nError loading stats. Try again later.");
  }
}
