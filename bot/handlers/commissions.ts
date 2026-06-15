import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users, commissionLedger } from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

/**
 * /commissions — admin command to see all creators with their referral debts
 * and mark them as paid.
 */
export async function handleCommissions(ctx: Context): Promise<void> {
  const db = getDb();

  // Get all creators with accrued commissions
  const rows = await db
    .select({
      beneficiaryId: commissionLedger.beneficiaryId,
      tgUsername: users.tgUsername,
      tgUserId: users.tgUserId,
      total: sql<string>`sum(${commissionLedger.amountUsdt})`,
      count: sql<number>`count(*)::int`,
    })
    .from(commissionLedger)
    .innerJoin(users, eq(commissionLedger.beneficiaryId, users.id))
    .where(eq(commissionLedger.status, "accrued"))
    .groupBy(commissionLedger.beneficiaryId, users.tgUsername, users.tgUserId)
    .orderBy(desc(sql`sum(${commissionLedger.amountUsdt})`));

  if (rows.length === 0) {
    await ctx.reply("✅ No outstanding commissions.");
    return;
  }

  const lines: string[] = [
    "💰 *Outstanding Commissions*",
    "",
    ...rows.map((r, i) => {
      const name = r.tgUsername ? `@${r.tgUsername}` : `id:${r.tgUserId}`;
      return `${i + 1}. ${name} — *${r.total} USDT* (${r.count} referral${r.count > 1 ? "s" : ""})`;
    }),
    "",
    "Total: *" + rows.reduce((s, r) => s + parseFloat(r.total), 0).toFixed(6) + " USDT*",
  ];

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: rows.map((r) => [
        {
          text: `✅ Paid ${r.tgUsername ? "@" + r.tgUsername : r.tgUserId.toString()} — ${r.total} USDT`,
          callback_data: `comm:pay:${r.beneficiaryId}`,
        },
      ]),
    },
  });
}

/**
 * Handle callback from /commissions — mark a creator's commissions as paid.
 */
export async function handleCommissionsCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("comm:pay:")) return;

  const beneficiaryId = data.split(":")[2];

  const db = getDb();

  // ALTER TYPE must be done separately, but enum value 'paid' is already added via migration
  // Mark all accrued commissions for this beneficiary as paid
  const result = await db
    .update(commissionLedger)
    .set({ status: "paid" })
    .where(
      and(
        eq(commissionLedger.beneficiaryId, beneficiaryId),
        eq(commissionLedger.status, "accrued"),
      ),
    )
    .returning({ count: sql<number>`count(*)::int` });

  await ctx.answerCallbackQuery({
    text: `✅ Marked as paid.`,
  });

  // Refresh the commissions list
  await handleCommissions(ctx);
}
