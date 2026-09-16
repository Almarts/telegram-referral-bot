import type { Context } from "grammy";
import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { users, freeTrialGrants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import {
  campaignInviteName,
  createCampaign,
  findCampaignByInviteLink,
  revokeCampaign,
  slugFromInviteName,
  campaignBotLink,
  CAMPAIGN_FREE_DAYS,
  CAMPAIGN_LINK_TTL_DAYS,
} from "@/bot/services/campaign";

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Build the message sent to a joiner who must confirm via /start. */
export function formatJoinMessage(params: {
  botUsername: string;
  ownerRefCode: string;
  freeDays: number;
}): string {
  return [
    "🎁 Тебе открыт бесплатный доступ на " + params.freeDays + " дней!",
    "",
    "Остался один шаг — нажми на кнопку ниже или отправь боту /start,",
    "чтобы активировать доступ и получить ссылку в канал.",
    "",
    `👉 https://t.me/${params.botUsername}?start=${params.ownerRefCode}`,
  ].join("\n");
}

/** Build the campaign-created reply for the admin. */
export function formatCampaignMessage(params: {
  inviteLink: string;
  botLink: string;
  freeDays: number;
  ttlDays: number;
  expiresAt: Date;
  slug: string;
}): string {
  return [
    `🎁 Ссылка бесплатного доступа на ${params.freeDays} дней`,
    "",
    params.botLink,
    "",
    `Активна ${params.ttlDays} дней (до ${params.expiresAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC). Многоразовая.`,
    "",
    "Каждый, кто перейдёт и нажмёт «Старт», получит:",
    `• бесплатный доступ на ${params.freeDays} дней (один раз на аккаунт)`,
    "• статус вашего реферала — комиссии с его оплат",
    "",
    "Напоминания о покупке придут за 7 дней и за 24 часа до конца доступа.",
    "Повторно бесплатный доступ не выдаётся — после истечения только оплата.",
    "",
    `Резервная ссылка прямо в канал (без триала): ${params.inviteLink}`,
    `Код компании: ${params.slug}`,
  ].join("\n");
}

// ── Trial bookkeeping ────────────────────────────────────────────────────────

/**
 * Atomically claim the one-time free trial for a Telegram user.
 *
 * Returns true when this call is the first ever trial for that user, false if
 * they already consumed one earlier (even via a different campaign link, and
 * even if that earlier trial has already expired).
 *
 * The primary key on `tg_user_id` makes this race-safe: concurrent attempts
 * from two different campaign links can never both win.
 */
export async function claimFreeTrial(params: {
  tgUserId: bigint;
  source: string;
  days: number;
}): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .insert(freeTrialGrants)
    .values({
      tgUserId: params.tgUserId,
      source: params.source,
      days: params.days,
    })
    .onConflictDoNothing()
    .returning();
  return rows.length > 0;
}

/** True when the user has already used their one-time free trial. */
export async function hasUsedFreeTrial(tgUserId: bigint): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ tgUserId: freeTrialGrants.tgUserId })
    .from(freeTrialGrants)
    .where(eq(freeTrialGrants.tgUserId, tgUserId))
    .limit(1);
  return rows.length > 0;
}

/** Message shown when a user follows a campaign link but already had a trial. */
export function formatTrialAlreadyUsedMessage(botUsername: string): string {
  return [
    "ℹ️ Бесплатный доступ уже был использован на этом аккаунте.",
    "",
    "Повторный бесплатный период не выдаётся — он доступен только один раз.",
    "",
    "Чтобы получить доступ к каналу, оформите подписку:",
    `👉 https://t.me/${botUsername}?start=buy`,
  ].join("\n");
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * Admin command /campaign — create a reusable free-access invite link.
 *
 * Usage:
 *   /campaign          → 90 days free, link valid 14 days
 *   /campaign 30 7     → 30 days free, link valid 7 days
 */
export async function handleCampaign(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const adminIds = getEnv().ADMIN_TG_IDS;
  if (!adminIds.includes(BigInt(tgUser.id))) return;

  const args = (ctx.match ?? "").toString().trim().split(/\s+/).filter(Boolean);
  const freeDays = args[0] ? Number(args[0]) : CAMPAIGN_FREE_DAYS;
  const ttlDays = args[1] ? Number(args[1]) : CAMPAIGN_LINK_TTL_DAYS;

  if (!Number.isFinite(freeDays) || freeDays <= 0 || freeDays > 3650) {
    await ctx.reply("❌ Неверное число дней доступа. Пример: /campaign 90 14");
    return;
  }
  if (!Number.isFinite(ttlDays) || ttlDays <= 0 || ttlDays > 365) {
    await ctx.reply("❌ Неверный срок жизни ссылки. Пример: /campaign 90 14");
    return;
  }

  try {
    const row = await createCampaign({
      ownerTgUserId: BigInt(tgUser.id),
      freeDays: Math.round(freeDays),
      linkTtlDays: Math.round(ttlDays),
    });

    const me = await ctx.api.getMe();
    const botUsername = me.username ?? "WhaleReferral_bot";

    await ctx.reply(
      formatCampaignMessage({
        inviteLink: row.inviteLink,
        botLink: campaignBotLink(botUsername, row.slug),
        freeDays: row.freeDays,
        ttlDays: Math.round(ttlDays),
        expiresAt: row.expiresAt,
        slug: row.slug,
      }),
      { link_preview_options: { is_disabled: true } },
    );
  } catch (err) {
    console.error("handleCampaign:", err);
    await ctx.reply(
      "❌ Не удалось создать ссылку: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Admin command /campaignstop <slug> — revoke a campaign link. */
export async function handleCampaignStop(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;
  const adminIds = getEnv().ADMIN_TG_IDS;
  if (!adminIds.includes(BigInt(tgUser.id))) return;

  const slug = (ctx.match ?? "").toString().trim();
  if (!slug) {
    await ctx.reply("Использование: /campaignstop <код компании>");
    return;
  }
  const ok = await revokeCampaign(slug);
  await ctx.reply(ok ? "✅ Ссылка отозвана." : "❌ Компания не найдена.");
}

/**
 * Handle a new chat member joining the channel.
 *
 * Telegram sends `chat_member` updates to channel admins. We look at the
 * invite link used (`invite_link.invite_link`) and match it against active
 * campaigns. Because a channel invite link cannot carry a start payload,
 * the joiner is DM'd a deep link carrying the owner's ref code — the
 * referral is only bound when they press /start.
 */
export async function handleChatMemberUpdate(ctx: Context): Promise<void> {
  const upd = ctx.chatMember;
  if (!upd) return;

  const newStatus = upd.new_chat_member.status;
  if (newStatus !== "member" && newStatus !== "administrator") return;

  const inviteLink = upd.invite_link?.invite_link;
  if (!inviteLink) return;

  const campaign = await findCampaignByInviteLink(inviteLink);
  if (!campaign) return;

  const joiner = upd.new_chat_member.user;
  if (joiner.is_bot) return;

  const bot = getBot();
  const me = await bot.api.getMe();
  const username = me.username ?? "WhaleReferral_bot";

  // One trial per account, ever. If this user already consumed a trial via any
  // earlier campaign link (or /free code), do not grant another one.
  try {
    const alreadyUsed = await hasUsedFreeTrial(BigInt(joiner.id));
    if (alreadyUsed) {
      await bot.api.sendMessage(
        Number(joiner.id),
        formatTrialAlreadyUsedMessage(username),
      );
      return;
    }
  } catch (err) {
    console.error("handleChatMemberUpdate: trial check failed:", err);
  }

  try {
    // Ensure the joiner has a user row so /start can bind the parent ref.
    const db = getDb();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tgUserId, BigInt(joiner.id)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!existing) {
      await db
        .insert(users)
        .values({
          tgUserId: BigInt(joiner.id),
          tgUsername: joiner.username ?? null,
          tgLang: joiner.language_code ?? null,
          parentRefCode: campaign.ownerRefCode,
        })
        .onConflictDoNothing();
    } else {
      // Bind the parent ref only if it was never set (idempotent, never overrides).
      await db
        .update(users)
        .set({ parentRefCode: campaign.ownerRefCode })
        .where(eq(users.id, existing.id));
    }

    await bot.api.sendMessage(
      Number(joiner.id),
      formatJoinMessage({
        botUsername: username,
        ownerRefCode: campaign.ownerRefCode,
        freeDays: campaign.freeDays,
      }),
    );
  } catch (err) {
    console.error("handleChatMemberUpdate: failed for", joiner.id, err);
  }
}

/**
 * Handle a join request (when the channel requires admin approval).
 * Same campaign matching logic; the request is approved automatically.
 */
export async function handleJoinRequest(ctx: Context): Promise<void> {
  const req = ctx.chatJoinRequest;
  if (!req) return;

  const inviteLink = req.invite_link?.invite_link;
  if (!inviteLink) return;

  const campaign = await findCampaignByInviteLink(inviteLink);
  if (!campaign) return;

  const bot = getBot();
  const channelId = getEnv().DEFAULT_CHANNEL_ID;

  // One trial per account, ever — check before approving the join request.
  try {
    const alreadyUsed = await hasUsedFreeTrial(BigInt(req.from.id));
    if (alreadyUsed) {
      try {
        await bot.api.declineChatJoinRequest(
          Number(channelId),
          Number(req.from.id),
        );
      } catch (err) {
        console.error("declineChatJoinRequest failed:", err);
      }
      const me0 = await bot.api.getMe();
      await bot.api
        .sendMessage(
          Number(req.from.id),
          formatTrialAlreadyUsedMessage(me0.username ?? "WhaleReferral_bot"),
        )
        .catch(() => {});
      return;
    }
  } catch (err) {
    console.error("handleJoinRequest: trial check failed:", err);
  }

  try {
    await bot.api.approveChatJoinRequest(
      Number(channelId),
      Number(req.from.id),
    );
  } catch (err) {
    console.error("approveChatJoinRequest failed:", err);
    return;
  }

  const me = await bot.api.getMe();
  const username = me.username ?? "WhaleReferral_bot";

  try {
    await bot.api.sendMessage(
      Number(req.from.id),
      formatJoinMessage({
        botUsername: username,
        ownerRefCode: campaign.ownerRefCode,
        freeDays: campaign.freeDays,
      }),
    );
  } catch (err) {
    console.error("handleJoinRequest: DM failed for", req.from.id, err);
  }
}

export { campaignInviteName, slugFromInviteName };
