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
    "Ссылка действительна 1 час и может быть использована один раз.",
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
 */
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
    const invite = await bot.api.createChatInviteLink(Number(channelId), {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600, // 1 hour
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
