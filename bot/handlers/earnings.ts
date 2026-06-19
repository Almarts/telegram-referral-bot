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
    await ctx.reply("Запустите /start");
    return;
  }

  const summary = await getEarningsSummary(user.id);

  const lines = [
    "💰 *Доход*",
    "",
    `💵 Выплачено: *${summary.paidUsdt} TRX*`,
    `💳 Доступно к выплате: *${summary.payableUsdt} TRX*`,
    `⏳ В ожидании: *${summary.accruedUsdt} TRX*`,
    `📈 Всего за всё время: *${summary.lifetimeUsdt} TRX*`,
    "",
    "📊 *Последние 30 дней:*",
    `  L1: *${summary.byLevel30d.l1} TRX*`,
    `  L2: *${summary.byLevel30d.l2} TRX*`,
  ];

  if (summary.recentPayouts.length > 0) {
    lines.push("", "📤 *Последние выплаты:*");
    for (const p of summary.recentPayouts.slice(0, 3)) {
      const hash = p.txHash ? `${p.txHash.slice(0, 10)}...` : "в обработке";
      lines.push(`  ${p.amountUsdt} TRX — ${hash}`);
    }
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" }).catch(async () => {
    await ctx.reply(lines.join("\n").replace(/[*`]/g, ""));
  });
}
