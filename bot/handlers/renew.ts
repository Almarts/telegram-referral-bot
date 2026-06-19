import type { Context } from "grammy";
import { getActivePlans } from "@/bot/services/invoices";
import { getDb } from "@/db/client";
import { users, subscriptions } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { handleBuy } from "./buy";

/**
 * /renew — продление подписки.
 * Берёт единственный активный план и сразу создаёт инвойс.
 */
export async function handleRenew(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) {
    await ctx.reply("❌ Не удалось определить пользователя.");
    return;
  }

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

  let plans;
  try {
    plans = await getActivePlans();
  } catch (err) {
    console.error("getActivePlans error:", err);
    await ctx.reply("❌ Что-то пошло не так. Попробуйте позже.");
    return;
  }

  if (plans.length === 0) {
    await ctx.reply("❌ Нет доступных тарифов.");
    return;
  }

  // Check if user has an active subscription
  const now = new Date();
  const activeSub = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, user.id),
        eq(subscriptions.status, "active"),
        gt(subscriptions.endsAt, now),
      ),
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (activeSub) {
    await ctx.reply("✅ У вас уже есть активная подписка. Используйте /buy, чтобы продлить.");
  } else {
    await ctx.reply("🔄 У вас нет активной подписки. Используйте /buy для покупки.");
  }
}
