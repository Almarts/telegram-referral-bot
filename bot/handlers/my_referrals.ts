import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getReferralStats } from "@/bot/services/dashboard";

export async function handleMyReferrals(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  await ctx.reply("Moи рефералы\n\nПока нет рефералов. Приглашай друзей по своей реферальной ссылке!");
}
