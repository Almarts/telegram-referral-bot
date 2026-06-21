import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

import type { ReplyKeyboardMarkup } from "grammy/types";

function regularKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "Купить доступ" }]],
    resize_keyboard: true,
  };
}

function creatorKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "Мои рефералы" }, { text: "Доход" }],
    ],
    resize_keyboard: true,
  };
}

/** Infer a reasonable UTC offset from Telegram language_code */
function inferUtcOffset(lang: string | undefined): number | null {
  if (!lang) return null;
  const l = lang.toLowerCase();
  // Russian-speaking users are typically UTC+3 (Moscow)
  if (l === "ru" || l === "be" || l === "uk") return 180;
  // Europe: many CET/CEST users
  if (["de", "fr", "es", "it", "pt", "nl", "pl", "tr", "el", "ro", "hu", "cs", "sv", "da", "fi", "nb", "hr", "sr", "bg"].includes(l)) return 60;
  // UK / IE
  if (["en", "ga"].includes(l)) return 0;
  return null;
}

export async function handleStart(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const name = tgUser.first_name ?? "там";

  const db = getDb();
  const user = await db
    .select({ id: users.id, role: users.role, utcOffset: users.utcOffset })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  const isCreator = user?.role === "creator";

  // Save UTC offset if not set yet
  if (user && user.utcOffset == null) {
    const offset = inferUtcOffset(tgUser.language_code);
    if (offset !== null) {
      await db
        .update(users)
        .set({ utcOffset: offset })
        .where(eq(users.id, user.id))
        .catch((err) => console.error("Failed to save utcOffset:", err));
    }
  }

  let lines: string[];
  let keyboard: ReplyKeyboardMarkup;

  if (isCreator) {
    lines = [
      `👋 Привет, ${name}!`,
      "",
      "Выбери опцию ниже:",
    ];
    keyboard = creatorKeyboard();
  } else {
    lines = [
      `👋 Привет, ${name}!`,
      "",
      "Нажми «Купить доступ», чтобы приобрести подписку.",
      "После оплаты ты получишь ссылку-приглашение в закрытый канал.",
    ];
    keyboard = regularKeyboard();
  }

  await ctx.reply(lines.join("\n"), {
    reply_markup: keyboard,
  });
}

export { regularKeyboard, creatorKeyboard };
