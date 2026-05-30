import { runCronJob } from "@/lib/cron-route";
import { settleIfPaid } from "@/lib/settle";
import { grantChannelAccess } from "@/bot/services/grant";
import { accrueCommissions } from "@/lib/commissions";
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return runCronJob(req, "scan-payments", 90, async () => {
    const db = getDb();
    let settled = 0;
    let skipped = 0;

    // Fetch pending invoices (limit to 200 per tick)
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

    for (const inv of pending) {
      const result = await settleIfPaid(inv.id);
      if (!result.settled) {
        skipped++;
        continue;
      }
      settled++;

      // Grant channel access after DB commit — best-effort (errors logged, not thrown)
      if (result.userId && result.planName) {
        await grantChannelAccess({
          userId: result.userId,
          planName: result.planName,
        }).catch((err) => console.error("grant:", err));
      }

      // Accrue commissions after settlement (idempotent by UNIQUE constraint)
      accrueCommissions(result.invoiceId).catch((err) =>
        console.error("commissions:", err),
      );
    }

    return { settled, skipped };
  });
}
