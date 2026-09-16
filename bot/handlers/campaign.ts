import type { Context } from "grammy";
import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import {
  campaignInviteName,
  createCampaign,
  findCampaignByInviteLink,
  revokeCampaign,
  slugFromInviteName,
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
  freeDays: number;
  ttlDays: number;
  expiresAt: Date;
}): string {
  return [
    `🔗 Ссылка бесплатного доступа на ${params.freeDays} дней`,
    "",
    params.inviteLink,
    "",
    `Многоразовая. Активна ${params.ttlDays} дней (до ${params.expiresAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 16)} UTC).`,
    "",
    "Каждый, кто перейдёт и нажмёт /start, получит:",
    `• бесплатный доступ на ${params.freeDays} дней`,
    "• статус вашего реферала (комиссии с его оплат)",
    "",
    "Напоминания о покупке придут за 7 дней и за 24 часа до конца доступа.",
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

    await ctx.reply(
      formatCampaignMessage({
        inviteLink: row.inviteLink,
        freeDays: row.freeDays,
        ttlDays: Math.round(ttlDays),
        expiresAt: row.expiresAt,
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
