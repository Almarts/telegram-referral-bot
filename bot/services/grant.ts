import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { safeReply } from "@/bot/utils/safe-reply";

// ── Pure formatting (no API calls, independently testable) ──────────────────

export function formatGrantMessage(params: {
  inviteLink: string;
  planName: string;
}): string {
  return [
    `✅ Платёж подтверждён! Твоя ссылка-приглашение *${params.planName}*:`,
    "",
    params.inviteLink,
    "",
    "Ссылка действительна до первого использования.",
  ].join("\n");
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface GrantParams {
  userId: string;
  planName: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTelegramUserId(dbUserId: string): Promise<bigint> {
  const db = getDb();
  const user = await db
    .select({ tgUserId: users.tgUserId })
    .from(users)
    .where(eq(users.id, dbUserId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) throw new Error(`User ${dbUserId} not found`);
  return user.tgUserId;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Send a one-shot channel invite link to the user after payment.
 * Creates a fresh invite link with member_limit=1 (single-use).
 * If the user was previously kicked, unban them first.
 */
/**
 * Revoke the channel's open primary invite link.
 *
 * Telegram always keeps a "primary" invite link on a channel, and revoking it
 * makes Telegram mint a fresh one — so this must be called repeatedly (every
 * cron tick). Links the bot creates pass `creates_join_request: true` and are
 * left alone; only the open, no-approval primary link is killed.
 */
export async function revokeOpenPrimaryLink(): Promise<void> {
  const bot = getBot();
  const channelId = getEnv().DEFAULT_CHANNEL_ID;
  try {
    const chat = await bot.api.getChat(Number(channelId));
    const primary = (chat as { invite_link?: string }).invite_link;
    if (!primary) return;
    await bot.api.revokeChatInviteLink(Number(channelId), primary);
    console.log("revokeOpenPrimaryLink: revoked", primary);
  } catch (err) {
    console.error("revokeOpenPrimaryLink failed:", err);
  }
}

export async function grantChannelAccess(params: GrantParams): Promise<void> {
  const bot = getBot();
  const channelId = getEnv().DEFAULT_CHANNEL_ID;

  let tgUserId: bigint;
  try {
    tgUserId = await getTelegramUserId(params.userId);
  } catch (err) {
    console.error("grantChannelAccess: user lookup failed:", err);
    throw err;
  }

  try {
    // If user was previously kicked, unban them so invite link works
    try {
      const member = await bot.api.getChatMember(Number(channelId), Number(tgUserId));
      if (member.status === "kicked") {
        await bot.api.unbanChatMember(Number(channelId), Number(tgUserId));
        console.log("grantChannelAccess: unbanned user", tgUserId);
      }
    } catch (_) {
      // getChatMember can fail if user never interacted — ignore
    }

    // NOTE: Telegram rejects member_limit together with creates_join_request,
    // so only the join-request flag is passed. Access is still gated by
    // handleJoinRequest (subscription check).
    const invite = await bot.api.createChatInviteLink(Number(channelId), {
      creates_join_request: true,
    });

    const message = formatGrantMessage({
      inviteLink: invite.invite_link,
      planName: params.planName,
    });

    await bot.api.sendMessage(Number(tgUserId), message, {
      parse_mode: "Markdown",
    }).catch(async (err) => {
      console.error("grantChannelAccess: Markdown send failed, sending plain text:", err.message);
      const plain = message.replace(/\*/g, "").replace(/_/g, "");
      await bot.api.sendMessage(Number(tgUserId), plain);
    });

    console.log("grantChannelAccess SUCCESS for user", tgUserId, "link:", invite.invite_link);
  } catch (err) {
    console.error("grantChannelAccess failed:", err);
  }
}
