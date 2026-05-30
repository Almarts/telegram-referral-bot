import type { Context } from "grammy";

import type { ReplyKeyboardMarkup } from "grammy/types";

export const MENU_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: "Buy access" }],
    [{ text: "My referrals" }, { text: "Earnings" }],
    [{ text: "Set payout address" }],
  ],
  resize_keyboard: true,
};

export async function handleStart(ctx: Context): Promise<void> {
  const name = ctx.from?.first_name ?? "there";

  const lines = [
    `Welcome, ${name}!`,
    "",
    "Choose an option below:",
  ];

  await ctx.reply(lines.join("\n"), {
    reply_markup: MENU_KEYBOARD,
  });
}
