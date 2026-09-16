import { NextResponse } from "next/server";
import { getBot } from "@/bot/bot";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Channel lockdown guard.
 *
 * A Telegram channel always exposes a "primary" invite link. Revoking it makes
 * Telegram mint a fresh one, so an open back door reappears on its own. This
 * endpoint revokes the channel's current open primary invite link — the one
 * that lets someone walk straight in without the bot approving them.
 *
 * Bot-created links (campaign links, one-time grant links) all pass
 * `creates_join_request: true`, so they are left untouched.
 *
 * Run it from a cron (e.g. every 10 minutes) and on demand.
 */
export async function GET(): Promise<Response> {
  const bot = getBot();
  const channelId = Number(getEnv().DEFAULT_CHANNEL_ID);

  const revoked: string[] = [];
  const errors: string[] = [];

  try {
    const chat = await bot.api.getChat(channelId);
    const primary = (chat as { invite_link?: string }).invite_link;
    if (primary) {
      try {
        await bot.api.revokeChatInviteLink(channelId, primary);
        revoked.push(primary);
      } catch (e) {
        errors.push(`${primary}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    errors.push(`getChat: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({
    ok: errors.length === 0,
    revoked,
    errors,
    note:
      "Revoked the channel's open primary invite link. Bot links use " +
      "creates_join_request=true and are intentionally kept.",
  });
}
