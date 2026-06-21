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
    await ctx.reply("Запустите /start");
    return;
  }

  const stats = await getReferralStats(user.id);

  const lines = [
    `👥 *Мои рефералы*`,
    "",
    "🔗 Твой реферальный код: " + user.refCode ?? "—",
    "",
    `📊 *Уровень 1* — прямые рефералы: *${stats.l1Count}*`,
    `💰 Оплаченных инвойсов L1: *${stats.l1LifetimePaid}*`,
    `📈 Твоя комиссия: *${(stats.l1TierBps / 100).toFixed(1)}%*`,
  ];

  if (stats.nextTier) {
    const nextRate = (stats.nextTier.bps / 100).toFixed(1);
    const need = stats.nextTier.min - stats.l1LifetimePaid;
    lines.push(
      `🏆 Следующий уровень: ${nextRate}% при ${stats.nextTier.min} оплатах (нужно ещё ${need})`,
    );
  }

  lines.push(
    "",
    `📊 *Уровень 2* — рефералы твоих рефералов: *${stats.l2Count}*`,
    `💰 Оплаченных инвойсов L2: *${stats.l2LifetimePaid}*`,
    `📈 Ты получаешь 10% от комиссий L1 на L2.`,
  );

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" }).catch(async () => {
    await ctx.reply(lines.join("\n").replace(/[*`]/g, ""));
  });
}
