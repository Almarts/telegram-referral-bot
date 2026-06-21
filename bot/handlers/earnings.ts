import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users, commissionLedger } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function handleEarnings(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  try {
    const db = getDb();

    const user = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tgUserId, BigInt(tgUser.id)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!user) {
      await ctx.reply("No account found. Use /start first.");
      return;
    }

    // Get all commissions for this user
    const rows = await db
      .select({
        amountUsdt: commissionLedger.amountUsdt,
        status: commissionLedger.status,
      })
      .from(commissionLedger)
      .where(eq(commissionLedger.beneficiaryId, user.id));

    // Calculate totals by status
    let accruedSum = 0n;
    let paidSum = 0n;
    let pendingSum = 0n;

    for (const row of rows) {
      const [i, f = ""] = row.amountUsdt.split(".");
      const val = BigInt(i + f.padEnd(6, "0").slice(0, 6));
      if (row.status === "paid") {
        paidSum += val;
      } else if (row.status === "pending") {
        pendingSum += val;
      } else {
        accruedSum += val;
      }
    }

    const totalSum = accruedSum + paidSum + pendingSum;

    const fmt = (v: bigint) => {
      const intPart = v / 1_000_000n;
      const fracPart = v % 1_000_000n;
      return `${intPart}.${String(fracPart).padStart(6, "0")}`;
    };

    let msg = `Earnings

Total all time: ${fmt(totalSum)} TRX`;
    if (accruedSum > 0n) {
      msg += `\nAccrued: ${fmt(accruedSum)} TRX`;
    }
    if (paidSum > 0n) {
      msg += `\nPaid out: ${fmt(paidSum)} TRX`;
    }
    if (pendingSum > 0n) {
      msg += `\nPending: ${fmt(pendingSum)} TRX`;
    }

    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply("Error loading earnings. Try again later.");
  }
}
