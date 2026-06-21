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

    // Get only accrued commissions (not yet paid out)
    const rows = await db
      .select({
        amountUsdt: commissionLedger.amountUsdt,
      })
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.beneficiaryId, user.id),
          eq(commissionLedger.status, "accrued"),
        ),
      );

    if (rows.length === 0) {
      await ctx.reply("Earnings\n\nNo pending earnings.");
      return;
    }

    let total = 0n;
    for (const row of rows) {
      const [i, f = ""] = row.amountUsdt.split(".");
      total += BigInt(i + f.padEnd(6, "0").slice(0, 6));
    }

    const intPart = total / 1_000_000n;
    const fracPart = total % 1_000_000n;
    const fmt = `${intPart}.${String(fracPart).padStart(6, "0")}`;

    await ctx.reply(`Earnings

Available: ${fmt} TRX`);
  } catch (e) {
    await ctx.reply("Error loading earnings. Try again later.");
  }
}
