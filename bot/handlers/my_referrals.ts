import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getReferralStats } from "@/bot/services/dashboard";

export async function handleMyReferrals(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const db = getDb();
  const user = await db
    .select({ id: users.id, refCode: users.refCode })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await ctx.reply("Please /start the bot first.");
    return;
  }

  const stats = await getReferralStats(user.id);

  const lines = [
    `Your referral code: \`${user.refCode ?? "—"}\``,
    `Share link: t.me/${ctx.me.username}?start=${user.refCode ?? ""}`,
    "",
    `L1 referrals: ${stats.l1Count}`,
    `L1 lifetime paid invoices: ${stats.l1LifetimePaid}`,
    `Your commission rate: ${(stats.l1TierBps / 100).toFixed(1)}%`,
  ];

  if (stats.nextTier) {
    const nextRate = (stats.nextTier.bps / 100).toFixed(1);
    const need = stats.nextTier.min - stats.l1LifetimePaid;
    lines.push(
      `Next tier: ${nextRate}% at ${stats.nextTier.min} paid invoices (${need} more needed)`,
    );
  }

  lines.push(
    "",
    `L2 referrals: ${stats.l2Count}`,
    `L2 lifetime paid invoices: ${stats.l2LifetimePaid}`,
  );

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}
