import { getDb } from "@/db/client";
import { opsKillSwitch } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { getBot } from "@/bot/bot";
import { getKv } from "@/lib/kv";

const PAYOUTS_KEY = "breakers:payouts-per-hour";
const WINDOW_SECONDS = 3600;

/**
 * Increment the payout counter for the sliding window (1 hour).
 * Returns the current count after increment.
 */
export async function incrPayoutCount(): Promise<number> {
  const kv = getKv();
  const count = await kv.incr(PAYOUTS_KEY);
  // Set expiry on first increment
  if (count === 1) {
    await kv.expire(PAYOUTS_KEY, WINDOW_SECONDS);
  }
  return count;
}

/**
 * Check and enforce the MAX_PAYOUTS_PER_HOUR circuit breaker.
 *
 * If the hourly payout count exceeds the configured maximum, the payout
 * kill switch is enabled and admins are notified.
 *
 * Returns true if payouts should proceed, false if blocked.
 */
export async function checkPayoutRateLimit(): Promise<boolean> {
  const env = getEnv();
  const count = await incrPayoutCount();

  if (count > env.MAX_PAYOUTS_PER_HOUR) {
    // Trigger kill switch
    const db = getDb();
    const reason = `MAX_PAYOUTS_PER_HOUR (${env.MAX_PAYOUTS_PER_HOUR}) exceeded: ${count} in 1h`;
    await db
      .update(opsKillSwitch)
      .set({ payoutDisabled: true, reason })
      .where(eq(opsKillSwitch.id, 1));

    // Alert admins
    const bot = getBot();
    for (const adminId of env.ADMIN_TG_IDS) {
      bot.api
        .sendMessage(Number(adminId), `CIRCUIT BREAKER: ${reason}`)
        .catch(() => {});
    }

    return false;
  }

  return true;
}

/**
 * Reset the payout rate limiter counter (e.g., after admin review).
 */
export async function resetPayoutRateLimit(): Promise<void> {
  await getKv().del(PAYOUTS_KEY);
}
