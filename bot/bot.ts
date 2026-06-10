import { Bot, Context } from "grammy";
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
import { handleDashboard, handleDashboardCallback } from "./handlers/admin_dashboard";
import { handleSubs } from "./handlers/admin_subs";
import { handleFinance } from "./handlers/admin_finance";
import { handleTree } from "./handlers/admin_tree";
import { adminOnly } from "./middleware/admin_only";
import { creatorOnly } from "./middleware/creator_only";
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

  // Text-based menu handlers — only for creators
  bot.hears("My referrals", creatorOnly, handleMyReferrals);
  bot.hears("Earnings", creatorOnly, handleEarnings);
  bot.hears("Set payout address", creatorOnly, handleSetPayoutAddress);
  bot.hears("Buy access", handleBuy);

  // Withdraw command — only for creators
  bot.command("withdraw", creatorOnly, handleWithdrawNow);

  // Admin (gated by ADMIN_TG_IDS)
  bot.command("admin", adminOnly, handleAdminStats);
  bot.command("add_creator", adminOnly, handleAddCreator);
  bot.command("dashboard", adminOnly, handleDashboard);
  bot.command("subs", adminOnly, handleSubs);
  bot.command("finance", adminOnly, handleFinance);
  bot.command("tree", adminOnly, handleTree);
  bot.command("payouts", adminOnly, async (ctx) => {
    const { getPendingPayouts } = await import("@/lib/payout-approval");
    const list = getPendingPayouts();
    if (list.length === 0) {
      await ctx.reply("No pending payouts right now.", { parse_mode: "Markdown" });
      return;
    }
    const lines = list.map(
      (p, i) =>
        `${i + 1}. \`${p.id}\` — ${p.amountUsdt} USDT → \`${p.toAddress.slice(0, 8)}…\` (${Math.floor((Date.now() - p.createdAt) / 1000)}s ago)`,
    );
    await ctx.reply(
      `*Pending payouts:* ${list.length}\n\n${lines.join("\n")}`,
      { parse_mode: "Markdown" },
    );
  });

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
    } else if (data.startsWith("admin:")) {
      await handleDashboardCallback(ctx);
    } else if (data.startsWith("approve:") || data.startsWith("reject:")) {
      const { handlePayoutCallback } = await import("@/lib/payout-approval");
      const tron = (await import("@/lib/tron")).getTron();
      await handlePayoutCallback(ctx, bot, tron);
    }
  });

  return bot;
}

let _bot: Bot<Context> | null = null;

export function getBot(): Bot<Context> {
  if (!_bot) _bot = createBot(getEnv().TELEGRAM_BOT_TOKEN);
  return _bot;
}
