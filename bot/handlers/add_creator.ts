import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import type { Context } from "grammy";

/**
 * /add_creator @username <creator_ref_code> [vip_bps]
 *
 * Admin-only: sets user role to "creator", links them to a referrer,
 * and grants channel access.
 *
 * Optional vip_bps: if provided (e.g. 5000), creator gets a fixed commission
 * rate regardless of tier progression. 5000 = 50%.
 * Example: /add_creator @big_blogger ABC123 5000  → 50% immediately
 */
export async function handleAddCreator(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  // Parse args: /add_creator @username REFCODE [vip_bps]
  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);

  if (parts.length < 3) {
    await ctx.reply(
      "Usage: /add_creator @username REFCODE [vip_bps]\n" +
        "Examples:\n" +
        "  /add_creator @some_user ABC123\n" +
        "  /add_creator @big_blogger ABC123 5000",
    );
    return;
  }

  const targetUsername = parts[1].replace(/^@/, "");
  const creatorRefCode = parts[2].toUpperCase();
  const vipBps = parts[3] ? parseInt(parts[3], 10) : null;

  if (vipBps !== null && (isNaN(vipBps) || vipBps < 0 || vipBps > 10000)) {
    await ctx.reply("vip_bps must be between 0 and 10000 (e.g. 5000 = 50%).");
    return;
  }

  const db = getDb();
  const bot = getBot();
  const channelId = getEnv().DEFAULT_CHANNEL_ID;

  try {
    // 1. Find the target user by tg_username
    const targetUser = await db
      .select({ id: users.id, tgUserId: users.tgUserId, role: users.role, refCode: users.refCode })
      .from(users)
      .where(eq(users.tgUsername, targetUsername))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!targetUser) {
      await ctx.reply(`User @${targetUsername} not found in database. They need to /start the bot first.`);
      return;
    }

    if (targetUser.role === "creator") {
      await ctx.reply(`@${targetUsername} is already a creator.`);
      return;
    }

    // 2. Verify the referrer ref_code exists
    const referrer = await db
      .select({ id: users.id, refCode: users.refCode })
      .from(users)
      .where(eq(users.refCode, creatorRefCode))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!referrer) {
      await ctx.reply(`Referrer ref_code "${creatorRefCode}" not found.`);
      return;
    }

    // 3. Update user: role=creator, parent_ref_code=creatorRefCode, optional vip_bps
    await db
      .update(users)
      .set({
        role: "creator",
        parentRefCode: creatorRefCode,
        vipBps: vipBps ?? null,
      })
      .where(eq(users.id, targetUser.id));

    // 4. Grant channel access (create invite link)
    const invite = await bot.api.createChatInviteLink(Number(channelId), {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    });

    // 5. Send invite to the new creator via DM
    const commissionText = vipBps
      ? `You earn: ${(vipBps / 100).toFixed(0)}% per referral, 10% L2.`
      : "You earn: 30% per referral (50% after 10), 10% L2.";

    const fullInviteMsg = [
      `🎉 Welcome to the creator program!`,
      "",
      `Here is the channel: ${invite.invite_link}`,
      "",
      `Your referral code: ${targetUser.refCode || "N/A"}`,
      "",
      commissionText,
    ].join("\n");

    await bot.api.sendMessage(Number(targetUser.tgUserId), fullInviteMsg, {
      parse_mode: "Markdown",
    }).catch(async (err) => {
      console.error("addCreator: DM Markdown failed:", err.message);
      await bot.api.sendMessage(
        Number(targetUser.tgUserId),
        fullInviteMsg.replace(/\*/g, ""),
      );
    });

    // 6. Confirm to admin
    const adminMsg =
      `✅ @${targetUsername} is now a *creator*.${vipBps ? ` (VIP: ${(vipBps / 100).toFixed(0)}%)` : ""}\n` +
      `Parent ref: ${creatorRefCode}\n` +
      `Invite link sent to @${targetUsername}.`;
    await ctx.reply(adminMsg, { parse_mode: "Markdown" }).catch(async (err) => {
      console.error("addCreator: admin confirm Markdown:", err.message);
      await ctx.reply(adminMsg.replace(/\*/g, ""));
    });
  } catch (err) {
    console.error("add_creator error:", err);
    await ctx.reply("❌ Error adding creator. Check logs.");
  }
}
