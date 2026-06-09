import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

import type { ReplyKeyboardMarkup } from "grammy/types";

function regularKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "Buy access" }]],
    resize_keyboard: true,
  };
}

function creatorKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "Buy access" }],
      [{ text: "My referrals" }, { text: "Earnings" }],
      [{ text: "Set payout address" }],
    ],
    resize_keyboard: true,
  };
}

export async function handleStart(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const name = tgUser.first_name ?? "there";

  // Determine user role
  const db = getDb();
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  const isCreator = user?.role === "creator";

  const lines = [
    `Welcome, ${name}!`,
    "",
    isCreator
      ? "Choose an option below:"
      : "Tap Buy access to purchase a subscription.",
  ];

  await ctx.reply(lines.join("\n"), {
    reply_markup: isCreator ? creatorKeyboard() : regularKeyboard(),
  });
}

export { regularKeyboard, creatorKeyboard };
