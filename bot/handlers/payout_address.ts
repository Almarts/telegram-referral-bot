import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setConvState, getConvState, clearConvState } from "@/bot/services/conv-state";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha256";

const AWAITING_STATE = "awaiting_payout_address";

const base58 = base58check(sha256);

function isValidTronAddress(addr: string): boolean {
  if (addr.length !== 34 || !addr.startsWith("T")) return false;
  try {
    const decoded = base58.decode(addr);
    // Valid TRON address: 21 bytes (0x41 prefix + 20-byte payload)
    return decoded.length === 21 && decoded[0] === 0x41;
  } catch {
    return false; // base58check checksum mismatch
  }
}

export async function handleSetPayoutAddress(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const db = getDb();
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await ctx.reply("Please /start the bot first.");
    return;
  }

  await setConvState(BigInt(tgUser.id), AWAITING_STATE);
  await ctx.reply(
    [
      "Send me your TRC20 USDT address to receive commission payouts.",
      "",
      "It should start with 'T' and be 34 characters long.",
      "",
      "After setting a new address, payouts are paused for 24 hours for security.",
    ].join("\n"),
  );
}

export async function handlePayoutAddressInput(
  ctx: Context,
  tgUserId: bigint,
  text: string,
): Promise<boolean> {
  const state = await getConvState(tgUserId);
  if (state !== AWAITING_STATE) return false;

  const addr = text.trim();

  if (!isValidTronAddress(addr)) {
    await ctx.reply(
      "Invalid TRC20 address. It should start with 'T' and be 34 characters long. Please try again or /cancel.",
    );
    return true; // consumed the message
  }

  const db = getDb();
  const user = await db
    .select({ id: users.id, payoutAddress: users.payoutAddress })
    .from(users)
    .where(eq(users.tgUserId, tgUserId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await clearConvState(tgUserId);
    return true;
  }

  await db
    .update(users)
    .set({
      payoutAddress: addr,
      payoutAddressChangedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await clearConvState(tgUserId);
  const paText = `Payout address set to ${addr}.`;
  await ctx.reply(paText, { parse_mode: "Markdown" }).catch(async (err) => {
    console.error("handlePayoutAddressInput: Markdown failed:", err.message);
    await ctx.reply(paText.replace(/\*/g, ""));
  });

  return true;
}
