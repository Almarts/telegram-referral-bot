/**
 * TEMP: manually scan payments.
 */
import { settleIfPaid } from "@/lib/settle";
import { grantChannelAccess } from "@/bot/services/grant";
import { accrueCommissions } from "@/lib/commissions";
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const pending = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, "open"),
        gt(invoices.expiresAt, sql`now() - interval '24 hours'`),
      ),
    )
    .limit(200);

  let settled = 0;
  for (const inv of pending) {
    const result = await settleIfPaid(inv.id);
    if (!result.settled) continue;
    settled++;
    if (result.userId && result.planName) {
      await grantChannelAccess({ userId: result.userId, planName: result.planName })
        .catch((e) => console.error("grant:", e));
    }
    await accrueCommissions(result.invoiceId)
      .catch((e) => console.error("commissions:", e));
  }
  return Response.json({ pending: pending.length, settled });
}
