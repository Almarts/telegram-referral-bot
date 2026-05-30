import type { Context } from "grammy";
import { getActivePlans } from "@/bot/services/invoices";
import { getDb } from "@/db/client";
import { users, subscriptions } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";

/**
 * /renew — show plan picker for renewal.
 *
 * The stacking rule is applied at settlement time in settle.ts:
 * if the user has an active subscription, the new one stacks (starts_at =
 * old.ends_at). Otherwise it starts now.
 */
export async function handleRenew(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) {
    await ctx.reply("Could not identify user.");
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
    await ctx.reply("Please /start the bot first.");
    return;
  }

  let plans;
  try {
    plans = await getActivePlans();
  } catch (err) {
    console.error("getActivePlans error:", err);
    await ctx.reply("Something went wrong. Please try again later.");
    return;
  }

  if (plans.length === 0) {
    await ctx.reply("No plans are currently available.");
    return;
  }

  // Check if user has an active subscription for contextual messaging
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

  const header = activeSub
    ? "Your subscription is active. Renewing will stack your new plan on top — no lost time. Choose a plan:"
    : "Choose a plan to renew:";

  await ctx.reply(header, {
    reply_markup: {
      inline_keyboard: plans.map((plan) => [
        {
          text: `${plan.name} — ${plan.priceUsdt} USDT (${plan.durationDays} days)`,
          callback_data: `buy:${plan.id}`,
        },
      ]),
    },
  });
}
