import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getBot } from "@/bot/bot";
import { getEnv } from "@/lib/env";
import { creatorKeyboard } from "./start";

/**
 * /makecreator tg_id [parent_ref_code] [vip_bps]
 *
 * Makes a user a creator (role='creator').
 * - tg_id: Telegram user ID (required)
 * - parent_ref_code: optional ref_code of another creator who referred this one
 * - vip_bps: optional VIP basis points (e.g. 5000 = 50%). Without it uses tiered system.
 *
 * Examples:
 *   /makecreator 944750077          — regular creator, tiered commissions
 *   /makecreator 944750077 EW0B4C   — creator with parent al_marts
 *   /makecreator 944750077 EW0B4C 5000 — VIP creator, 50% fixed
 */
export async function handleMakeCreator(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  // Admin-only check
  const adminIds = getEnv().ADMIN_TG_IDS;
  if (!adminIds.includes(BigInt(tgUser.id))) return;

  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  // /makecreator tg_id [parent_ref_code] [vip_bps]
  if (parts.length < 2) {
    await ctx.reply(
      "❌ Использование:\n" +
      "`/makecreator tg_id [parent_ref_code] [vip_bps]`\n\n" +
      "Примеры:\n" +
      "`/makecreator 944750077` — обычный создатель\n" +
      "`/makecreator 944750077 EW0B4C` — создатель + реф от al_marts\n" +
      "`/makecreator 944750077 EW0B4C 5000` — VIP создатель (50%)",
      { parse_mode: "Markdown" },
    );
    return;
  }

  const rawTarget = parts[1];
  const isNumeric = /^\d+$/.test(rawTarget);
  // If it looks like @username or a plain username (not a numeric tg_id)
  const targetUsername = rawTarget.replace(/^@/, "");

  const parentRefCode = parts.length >= 3 ? parts[2].toUpperCase() : undefined;
  const vipBpsArg = parts.length >= 4 ? parseInt(parts[3], 10) : undefined;

  if (vipBpsArg !== undefined && (isNaN(vipBpsArg) || vipBpsArg < 0 || vipBpsArg > 10000)) {
    await ctx.reply("❌ vip_bps должен быть от 0 до 10000 (0% — 100%).");
    return;
  }

  const db = getDb();

  try {
    // Find target user — by tg_id (numeric) or by tg_username
    let target;
    if (isNumeric) {
      target = await db
        .select()
        .from(users)
        .where(eq(users.tgUserId, BigInt(rawTarget)))
        .limit(1)
        .then((r) => r[0] ?? null);
    } else {
      target = await db
        .select()
        .from(users)
        .where(eq(users.tgUsername, targetUsername))
        .limit(1)
        .then((r) => r[0] ?? null);
    }

    if (!target) {
      await ctx.reply(
        `❌ Пользователь \`${rawTarget}\` не найден. Сначала /start.`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (target.role === "creator") {
      await ctx.reply(`ℹ️ @${target.tgUsername ?? rawTarget} уже создатель.`);
      return;
    }

    // Validate parent_ref_code if provided
    if (parentRefCode) {
      const parent = await db
        .select()
        .from(users)
        .where(eq(users.refCode, parentRefCode))
        .limit(1)
        .then((r) => r[0] ?? null);

      if (!parent) {
        await ctx.reply(`❌ Реф-код \`${parentRefCode}\` не найден.`, { parse_mode: "Markdown" });
        return;
      }

      if (parent.role !== "creator") {
        await ctx.reply(`❌ \`${parentRefCode}\` не является создателем. Родитель должен быть creator.`, { parse_mode: "Markdown" });
        return;
      }

      // Check for circular reference
      if (parent.id === target.id) {
        await ctx.reply("❌ Нельзя сделать себя своим рефералом.");
        return;
      }
    }

    // Update the user
    const updateData: Record<string, unknown> = { role: "creator" };
    if (parentRefCode) updateData.parentRefCode = parentRefCode;
    if (vipBpsArg !== undefined) updateData.vipBps = vipBpsArg;

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, target.id));

    const name = target.tgUsername ? `@${target.tgUsername}` : `id:${rawTarget}`;
    const vipNote = vipBpsArg !== undefined ? ` (VIP, ${(vipBpsArg / 100).toFixed(0)}%)` : "";
    const parentNote = parentRefCode ? `, parent: \`${parentRefCode}\`` : "";

    await ctx.reply(
      `✅ ${name} теперь создатель${vipNote}!${parentNote}\n` +
      `Реф-код: \`${target.refCode}\``,
      { parse_mode: "Markdown" },
    );

    // Send invite link to the new creator
    try {
      const bot = getBot();
      const channelId = getEnv().DEFAULT_CHANNEL_ID;

      // Unban if kicked
      try {
        const member = await bot.api.getChatMember(Number(channelId), Number(target.tgUserId));
        if (member.status === "kicked") {
          await bot.api.unbanChatMember(Number(channelId), Number(target.tgUserId));
        }
      } catch (_) {}

      const invite = await bot.api.createChatInviteLink(Number(channelId), {
        member_limit: 1,
      });

      await bot.api.sendMessage(
        Number(target.tgUserId),
        `🎉 Ты стал создателем!\n\n🔗 Твоя ссылка на вход в канал:\n${invite.invite_link}\n\nДействительна до первого использования.`,
      );

      // Send creator keyboard separately
      await bot.api.sendMessage(
        Number(target.tgUserId),
        "Теперь тебе доступны кнопки:",
        { reply_markup: creatorKeyboard() },
      );
    } catch (inviteErr) {
      console.error("handleMakeCreator: invite failed:", inviteErr);
    }
  } catch (err) {
    console.error("handleMakeCreator:", err);
    await ctx.reply("❌ Ошибка. Проверьте логи.");
  }
}

/**
 * /invite
 *
 * Generates a one-time invite link to the private channel.
 */
export async function handleInvite(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  // Admin-only check
  const adminIds = getEnv().ADMIN_TG_IDS;
  if (!adminIds.includes(BigInt(tgUser.id))) return;

  try {
    const bot = getBot();
    const channelId = getEnv().DEFAULT_CHANNEL_ID;

    const invite = await bot.api.createChatInviteLink(Number(channelId), {
      member_limit: 1,
    });

    await ctx.reply(
      `🔗 Одноразовая ссылка в канал:\n${invite.invite_link}\n\n` +
      `Действительна до первого использования.`,
      { disable_web_page_preview: true },
    );
  } catch (err) {
    console.error("handleInvite:", err);
    await ctx.reply("❌ Ошибка создания ссылки. Проверьте логи.");
  }
}
