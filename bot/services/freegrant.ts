import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { invoices, subscriptions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { getKv } from "@/lib/kv";

// ── Constants ────────────────────────────────────────────────────────────────

export const FREE_DAYS = 90;
export const FREE_CODE_TTL_S = 7 * 24 * 60 * 60; // 7 days
// Free grants create a zero-value invoice but reference the real "3 Months" plan
// (id=1) to satisfy the FK on invoices.planId.
const FREE_PLAN_ID = 1;

// ── KV key helpers ───────────────────────────────────────────────────────────

export function freeCodeKey(code: string): string {
  return `freegrant:${code}`;
}

/** Strip the `free_` prefix from a start payload. Returns null if not a free code. */
export function parseFreePayload(payload: string | undefined): string | null {
  if (!payload) return null;
  const m = /^free_([A-Za-z0-9]{20,40})$/.exec(payload.trim());
  return m ? m[1] : null;
}

// ── Generator ────────────────────────────────────────────────────────────────

function randCode(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) s += charset[bytes[i] % charset.length];
  return s;
}

/**
 * Admin: generate a fresh one-time free code and store it in KV.
 * Returns the raw code (without the `free_` prefix).
 */
export async function createFreeCode(): Promise<string> {
  const kv = getKv();
  // Collision-free retry
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randCode();
    const ok = await kv.set(freeCodeKey(code), "1", { nx: true, ex: FREE_CODE_TTL_S });
    if (ok === "OK") return code;
  }
  throw new Error("Could not allocate a free code");
}

/**
 * Validate + consume a free code. Returns true if valid and was present.
 */
export async function consumeFreeCode(code: string): Promise<boolean> {
  const kv = getKv();
  const exists = await kv.get(freeCodeKey(code));
  if (exists === null) return false;
  // Atomically delete — marks the code as used.
  await kv.del(freeCodeKey(code));
  return true;
}

// ── Grant ────────────────────────────────────────────────────────────────────

/**
 * Grant a free 3-month (90-day) subscription to a user,
 * then send a one-time channel invite link.
 */
export async function grantFreeAccess(
  userId: string,
  days: number = FREE_DAYS,
): Promise<void> {
  const db = getDb();
  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;
  const now = new Date();
  const endsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Create a zero-value invoice to satisfy the subscription FK (invoiceId notNull).
  const [invoice] = await db
    .insert(invoices)
    .values({
      userId,
      planId: FREE_PLAN_ID,
      depositAddress: coldAddress,
      derivIndex: 0,
      amountUsdt: "0.000000",
      status: "paid",
      expiresAt: now,
    })
    .returning();

  await db.insert(subscriptions).values({
    userId,
    invoiceId: invoice.id,
    startsAt: now,
    endsAt,
    channelId: getEnv().DEFAULT_CHANNEL_ID,
    status: "active",
  });

  // Resolve Telegram user id for messaging
  const row = await db
    .select({ tgUserId: users.tgUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) return;

  // Create + send one-time invite link
  try {
    const bot = getBot();
    const channelId = getEnv().DEFAULT_CHANNEL_ID;
    const inv = await bot.api.createChatInviteLink(Number(channelId), { member_limit: 1 });
    const msg = [
      "🎁 Тебе выдан бесплатный доступ на 3 месяца!",
      "",
      `🔗 Твоя ссылка на вход в канал:`,
      inv.invite_link,
      "",
      "Ссылка действительна до первого использования.",
    ].join("\n");
    await bot.api.sendMessage(Number(row.tgUserId), msg).catch(async (err) => {
      console.error("grantFreeAccess: Markdown send failed, plain text:", err.message);
      await bot.api.sendMessage(Number(row.tgUserId), msg.replace(/[*`_]/g, ""));
    });
  } catch (err) {
    console.error("grantFreeAccess: invite failed:", err);
  }
}
