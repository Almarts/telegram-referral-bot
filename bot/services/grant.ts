import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";

// ── Pure formatting (no API calls, independently testable) ──────────────────

export function formatGrantMessage(params: {
  inviteLink: string;
  planName: string;
}): string {
  return [
    `Payment confirmed! Here's your invite link for *${params.planName}*:`,
    "",
    params.inviteLink,
    "",
    "This link is valid for 1 hour and can only be used once.",
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
 *
 * Creates a Telegram invite link with member_limit=1, expire_date=now+1h,
 * then DMs the user. This is called AFTER the DB transaction commits.
 *
 * On failure (e.g. bot lacks admin rights, user blocked the bot), the error
 * is logged but NOT re-thrown — settlement already succeeded, grant is
 * best-effort. The user can use "I've paid" to trigger a retry, or an admin
 * can manually send the link.
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
    // Create one-shot invite link
    const invite = await bot.api.createChatInviteLink(Number(channelId), {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    });

    // DM the user
    const message = formatGrantMessage({
      inviteLink: invite.invite_link,
      planName: params.planName,
    });

    await bot.api.sendMessage(Number(tgUserId), message, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("grantChannelAccess failed:", err);
    // Don't re-throw — settlement already succeeded, grant is best-effort
  }
}
