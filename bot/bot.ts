import { Bot, Context } from "grammy";
import { handleStart } from "./handlers/start";
import { handleBuy, handleBuyCallback, handleTxid } from "./handlers/buy";
import { handleRenew } from "./handlers/renew";
import { handleMyReferrals } from "./handlers/my_referrals";
import { handleEarnings } from "./handlers/earnings";
import { handleDashboard } from "./handlers/admin_dashboard";
import { handleCommissions, handleCommissionsCallback } from "./handlers/commissions";
import { handleMakeCreator, handleInvite, handleFree } from "./handlers/admin_tools";
import {
  handleCampaign,
  handleCampaignStop,
  handleChatMemberUpdate,
  handleJoinRequest,
} from "./handlers/campaign";
import { onboardUser } from "./services/onboarding";
import {
  grantFreeAccess,
  consumeFreeCode,
  parseFreePayload,
} from "./services/freegrant";
import {
  claimFreeTrial,
  hasUsedFreeTrial,
  formatTrialAlreadyUsedMessage,
} from "./handlers/campaign";
import {
  findCampaignBySlug,
  campaignBotLink,
  recordJoin,
} from "./services/campaign";
import { grantChannelAccess } from "./services/grant";
import { findActiveSubscription } from "./services/subscriptions";
import { getEnv } from "@/lib/env";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

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

      // Trial campaign flow: /start <campaignSlug> where the slug belongs to an
      // active campaign owned by an admin. Grants the one-time 90-day trial and
      // binds the joiner as the campaign owner's referral.
      const startPayload =
        typeof ctx.match === "string" ? ctx.match.trim() : undefined;

      if (startPayload) {
        try {
          const camp = await findCampaignBySlug(startPayload);
          if (camp) {
            const alreadyUsed = await hasUsedFreeTrial(BigInt(tgUser.id));
            if (alreadyUsed) {
              // Second attempt at the trial. The trial itself is never granted
              // twice — but if they still have a LIVE subscription (they paid
              // for it, or the trial is still running) they must be able to
              // re-enter the channel, e.g. after leaving by accident.
              const db = getDb();
              const urow = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.tgUserId, BigInt(tgUser.id)))
                .limit(1)
                .then((r) => r[0] ?? null);

              const active = urow ? await findActiveSubscription(urow.id) : null;

              if (urow && active) {
                await grantChannelAccess({
                  userId: urow.id,
                  planName: `до ${active.endsAt
                    .toISOString()
                    .replace("T", " ")
                    .slice(0, 10)}`,
                });
                await ctx.reply(
                  `ℹ️ Бесплатный доступ уже был использован, но твоя подписка ещё активна — новая ссылка в канал отправлена выше.`,
                );
              } else {
                const me = await bot.api.getMe();
                await ctx.reply(
                  formatTrialAlreadyUsedMessage(
                    me.username ?? "WhaleReferral_bot",
                  ),
                );
              }
            } else {
              const claimed = await claimFreeTrial({
                tgUserId: BigInt(tgUser.id),
                source: `campaign:${camp.slug}`,
                days: camp.freeDays,
              });
              if (claimed) {
                const db = getDb();
                const dbUser = await db
                  .select({ id: users.id })
                  .from(users)
                  .where(eq(users.tgUserId, BigInt(tgUser.id)))
                  .limit(1)
                  .then((r) => r[0] ?? null);
                if (dbUser) {
                  // Bind the campaign owner as the referral parent (never
                  // overrides an existing parent — onboarding already set it
                  // from the payload when the code matched a user).
                  await db
                    .update(users)
                    .set({ parentRefCode: camp.ownerRefCode })
                    .where(eq(users.id, dbUser.id));
                  await grantFreeAccess(dbUser.id, camp.freeDays);
                  await recordJoin({
                    campaignId: camp.id,
                    tgUserId: BigInt(tgUser.id),
                    state: "granted",
                  });
                  await ctx.reply("✅ Твой бесплатный доступ активирован!");
                }
              } else {
                const me = await bot.api.getMe();
                await ctx.reply(
                  formatTrialAlreadyUsedMessage(
                    me.username ?? "WhaleReferral_bot",
                  ),
                );
              }
            }
          }
        } catch (err) {
          console.error("campaign trial flow error:", err);
          await ctx.reply("❌ Не удалось активировать доступ. Попробуйте позже.");
        }
      }

      // Free-access link flow: /start free_<CODE>
      const freeCode = parseFreePayload(
        typeof ctx.match === "string" ? ctx.match : undefined,
      );
      if (freeCode) {
        try {
          // One trial per account, ever — check BEFORE consuming the code so a
          // repeat user does not burn the link for others.
          const alreadyUsed = await hasUsedFreeTrial(BigInt(tgUser.id));
          if (alreadyUsed) {
            const me = await bot.api.getMe();
            await ctx.reply(
              formatTrialAlreadyUsedMessage(me.username ?? "WhaleReferral_bot"),
            );
          } else {
            const ok = await consumeFreeCode(freeCode);
            if (ok) {
              const db = getDb();
              const dbUser = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.tgUserId, BigInt(tgUser.id)))
                .limit(1)
                .then((r) => r[0] ?? null);
              if (dbUser) {
                // Claim the trial slot and re-check atomically: if another
                // request won the race meanwhile, do not grant a second time.
                const claimed = await claimFreeTrial({
                  tgUserId: BigInt(tgUser.id),
                  source: `free_code:${freeCode.slice(0, 8)}`,
                  days: 90,
                });
                if (claimed) {
                  await grantFreeAccess(dbUser.id);
                  await ctx.reply("✅ Твой бесплатный доступ активирован!");
                } else {
                  const me = await bot.api.getMe();
                  await ctx.reply(
                    formatTrialAlreadyUsedMessage(
                      me.username ?? "WhaleReferral_bot",
                    ),
                  );
                }
              }
            } else {
              await ctx.reply("❌ Эта ссылка недействительна или уже использована.");
            }
          }
        } catch (err) {
          console.error("free grant flow error:", err);
          await ctx.reply("❌ Не удалось активировать доступ. Попробуйте позже.");
        }
      }
    }
    await handleStart(ctx);
  });

  bot.command("buy", handleBuy);
  bot.command("renew", handleRenew);

  // Text-based menu handlers — Russian keyboard buttons
  bot.hears("Мои рефералы", async (ctx) => {
    try {
      const tgUser = ctx.from;
      if (!tgUser) return;
      const db = getDb();
      const user = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.tgUserId, BigInt(tgUser.id)))
        .limit(1)
        .then((r) => r[0] ?? null);
      if (user?.role !== "creator") return;
      await handleMyReferrals(ctx);
    } catch (e) {
      console.error("Мои рефералы error:", e);
      await ctx.reply("❌ Ошибка. Попробуйте позже.").catch(() => {});
    }
  });

  bot.hears("Доход", async (ctx) => {
    try {
      const tgUser = ctx.from;
      if (!tgUser) return;
      const db = getDb();
      const user = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.tgUserId, BigInt(tgUser.id)))
        .limit(1)
        .then((r) => r[0] ?? null);
      if (user?.role !== "creator") return;
      await handleEarnings(ctx);
    } catch (e) {
      console.error("Доход error:", e);
      await ctx.reply("❌ Ошибка. Попробуйте позже.").catch(() => {});
    }
  });

  bot.hears("Купить доступ", handleBuy);

  // Admin dashboard
  bot.command("admin", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    try {
      await handleDashboard(ctx);
    } catch (e) {
      console.error("ADMIN_CMD_ERR", e instanceof Error ? e.message : String(e));
      try { await ctx.reply("⚠️ Ошибка загрузки панели. Проверьте логи."); } catch {}
    }
  });

  bot.hears("", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser || ctx.message?.text !== "/admin") return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    try {
      await handleDashboard(ctx);
    } catch (e) {
      console.error("ADMIN_HEARS_ERR", e instanceof Error ? e.message : String(e));
      try { await ctx.reply("⚠️ Ошибка загрузки панели. Проверьте логи."); } catch {}
    }
  });

  bot.command("commissions", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    await handleCommissions(ctx);
  });

  // Admin: make a user a creator
  bot.command("makecreator", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    await handleMakeCreator(ctx);
  });

  // Admin: generate one-time invite link
  bot.command("invite", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    await handleInvite(ctx);
  });

  // Admin: generate a free 3-month access link for a friend
  bot.command("free", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    await handleFree(ctx);
  });

  // Admin: reusable free-access campaign link (default: 90 days free, link live 14 days)
  bot.command("campaign", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    await handleCampaign(ctx);
  });

  bot.command("campaignstop", async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    const adminIds = getEnv().ADMIN_TG_IDS;
    if (!adminIds.includes(BigInt(tgUser.id))) return;
    await handleCampaignStop(ctx);
  });

  // Channel joins via a campaign invite link.
  bot.on("chat_member", async (ctx) => {
    try {
      await handleChatMemberUpdate(ctx);
    } catch (e) {
      console.error("chat_member handler error:", e);
    }
  });

  bot.on("chat_join_request", async (ctx) => {
    try {
      await handleJoinRequest(ctx);
    } catch (e) {
      console.error("chat_join_request handler error:", e);
    }
  });

  // Handle TXID — user pastes transaction hash after payment
  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text ?? "";
    // If it looks like a TRON TXID (64 hex chars), try to settle
    if (/^[0-9a-fA-F]{64}$/.test(text.trim())) {
      await handleTxid(ctx);
    }
    // Otherwise silently ignore unrecognized text messages
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery?.data ?? "";
    if (data.startsWith("buy:")) {
      await handleBuyCallback(ctx);
    } else if (data.startsWith("admin:")) {
      const { handleDashboardCallback } = await import("./handlers/admin_dashboard");
      await handleDashboardCallback(ctx);
    } else if (data.startsWith("comm:")) {
      await handleCommissionsCallback(ctx);
    }
  });

  return bot;
}

let _bot: Bot<Context> | null = null;

export function getBot(): Bot<Context> {
  if (!_bot) _bot = createBot(getEnv().TELEGRAM_BOT_TOKEN);
  return _bot;
}
