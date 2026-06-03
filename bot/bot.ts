import { Bot } from "grammy";
import type { Context } from "grammy";
import { handleStart } from "./handlers/start";
import { handleBuy, handleBuyCallback, handleCheckCallback } from "./handlers/buy";
import { handleRenew } from "./handlers/renew";
import { handleMyReferrals } from "./handlers/my_referrals";
import { handleEarnings } from "./handlers/earnings";
import {
  handleSetPayoutAddress,
  handlePayoutAddressInput,
} from "./handlers/payout_address";
import { handleWithdrawNow } from "./handlers/withdraw_now";
import { handleAdminStats } from "./handlers/admin_stats";
import { handleAddCreator } from "./handlers/add_creator";
import { adminOnly } from "./middleware/admin_only";
import { onboardUser } from "./services/onboarding";
import { getEnv } from "@/lib/env";

export function createBot(token: string): Bot<Context> {
  const bot = new Bot<Context>(token);

  bot.command("start", async (ctx) => {
    const tgUser = ctx.from;
    if (tgUser) {
      await onboardUser({
        tgUserId: BigInt(tgUser.id),
        tgUsername: tgUser.username,
        tgLang: tgUser.language_code,
        startPayload: typeof ctx.match === "string" ? ctx.match : undefined,
      });
    }
    await handleStart(ctx);
  });

  bot.command("buy", handleBuy);
  bot.command("renew", handleRenew);

  // Text-based menu handlers
  bot.hears("My referrals", handleMyReferrals);
  bot.hears("Earnings", handleEarnings);
  bot.hears("Set payout address", handleSetPayoutAddress);
  bot.hears("Buy access", handleBuy);

  // Withdraw command
  bot.command("withdraw", handleWithdrawNow);

  // Admin (gated by ADMIN_TG_IDS)
  bot.command("admin", adminOnly, handleAdminStats);
  bot.command("add_creator", adminOnly, handleAddCreator);

  // Payout address conversation: intercept text messages when in awaiting state
  bot.on("message:text", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;

    const text = ctx.message?.text ?? "";
    const handled = await handlePayoutAddressInput(ctx, BigInt(tgUser.id), text);
    if (handled) return;

    // If not handled by conversation state, it's an unrecognized message
    // Silently ignore — the menu keyboard handles navigation
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery?.data ?? "";
    if (data.startsWith("buy:")) {
      await handleBuyCallback(ctx);
    } else if (data.startsWith("check:")) {
      await handleCheckCallback(ctx);
    } else if (data === "withdraw_now") {
      await handleWithdrawNow(ctx);
    }
  });

  return bot;
}

let _bot: Bot<Context> | null = null;

export function getBot(): Bot<Context> {
  if (!_bot) _bot = createBot(getEnv().TELEGRAM_BOT_TOKEN);
  return _bot;
}
