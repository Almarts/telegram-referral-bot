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
      [{ text: "Withdraw" }, { text: "Set payout address" }],
    ],
    resize_keyboard: true,
  };
}

/** Creator with vipBps set — has full menu + VIP message (no "Buy access" shown if you're VIP). */
function vipKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "My referrals" }, { text: "Earnings" }],
      [{ text: "Withdraw" }, { text: "Set payout address" }],
    ],
    resize_keyboard: true,
  };
}

export async function handleStart(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const name = tgUser.first_name ?? "there";

  // Determine user role & vip status
  const db = getDb();
  const user = await db
    .select({ role: users.role, vipBps: users.vipBps })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  const isCreator = user?.role === "creator";
  const isVip = isCreator && user?.vipBps != null;

  let lines: string[];
  let keyboard: ReplyKeyboardMarkup;

  if (isVip) {
    const pct = (user.vipBps / 100).toFixed(0);
    lines = [
      `Welcome, ${name}! 🎉`,
      "",
      `You're a VIP creator — you earn ${pct}% per referral.`,
      "",
      "Choose an option below:",
    ];
    keyboard = vipKeyboard();
  } else if (isCreator) {
    lines = [
      `Welcome, ${name}!`,
      "",
      "Choose an option below:",
    ];
    keyboard = creatorKeyboard();
  } else {
    lines = [
      `Welcome, ${name}!`,
      "",
      "Tap Buy access to purchase a subscription.",
    ];
    keyboard = regularKeyboard();
  }

  await ctx.reply(lines.join("\n"), {
    reply_markup: keyboard,
  });
}

export { regularKeyboard, creatorKeyboard, vipKeyboard };
