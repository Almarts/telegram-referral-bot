import { Bot, Context } from "grammy";
import { handleStart } from "./handlers/start";
import { handleBuy, handleBuyCallback, handleTxid } from "./handlers/buy";
import { handleRenew } from "./handlers/renew";
import { handleMyReferrals } from "./handlers/my_referrals";
import { handleEarnings } from "./handlers/earnings";
import { handleDashboard } from "./handlers/admin_dashboard";
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

  // Text-based menu handlers — creators see referrals/earnings
  bot.hears("My referrals", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const { getDb } = await import("@/db/client");
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const user = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.tgUserId, BigInt(tgUser.id)))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (user?.role !== "creator") return;
    await handleMyReferrals(ctx);
  });

  bot.hears("Earnings", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const { getDb } = await import("@/db/client");
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const user = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.tgUserId, BigInt(tgUser.id)))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (user?.role !== "creator") return;
    await handleEarnings(ctx);
  });

  bot.hears("Buy access", handleBuy);

  // Handle TXID — user pastes transaction hash after payment
  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text ?? "";
    // If it looks like a TRON TXID (64 hex chars), try to settle
    if (/^[0-9a-fA-F]{64}$/.test(text.trim())) {
      await handleTxid(ctx);
    }
    // Otherwise silently ignore unrecognized text messages
  });

  // Admin dashboard
  bot.command("admin", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    await handleDashboard(ctx);
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery?.data ?? "";
    if (data.startsWith("buy:")) {
      await handleBuyCallback(ctx);
    } else if (data.startsWith("admin:")) {
      const { handleDashboardCallback } = await import("./handlers/admin_dashboard");
      await handleDashboardCallback(ctx);
    }
  });

  return bot;
}

let _bot: Bot<Context> | null = null;

export function getBot(): Bot<Context> {
  if (!_bot) _bot = createBot(getEnv().TELEGRAM_BOT_TOKEN);
  return _bot;
}
