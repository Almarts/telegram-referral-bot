import { runCronJob } from "@/lib/cron-route";
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";
import { settleByTxId } from "@/lib/settle";
import { grantChannelAccess } from "@/bot/services/grant";
import { accrueCommissions } from "@/lib/commissions";
import { gte } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scan-payments: check all open invoices for unexpected payments to cold wallet.
 * This runs as a fallback in case a user pays but forgets to submit TXID.
 */
export async function GET(req: Request): Promise<Response> {
  return runCronJob(req, "scan-payments", 90, async () => {
    const db = getDb();
    const tron = getTron();
    const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;
    let settled = 0;

    // Fetch pending invoices (not expired yet)
    const pending = await db
      .select({ id: invoices.id, amountUsdt: invoices.amountUsdt })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, "open"),
          gt(invoices.expiresAt, sql`now() - interval '24 hours'`),
        ),
      )
      .limit(200);

    if (pending.length === 0) {
      return { settled: 0 };
    }

    // Get recent transfers to cold wallet
    const transfers = await tron.listUsdtTransfersTo(coldAddress, {
      sinceMs: Date.now() - 30 * 60 * 1000, // last 30 min
    });

    if (transfers.length === 0) {
      return { settled: 0 };
    }

    for (const inv of pending) {
      // Find a matching transfer
      const match = transfers.find(
        (t) => t.confirmed && gte(t.amountUsdt, inv.amountUsdt),
      );
      if (!match) continue;

      const result = await settleByTxId(inv.id, match.txHash);
      if (!result.settled) continue;
      settled++;

      if (result.userId && result.planName) {
        await grantChannelAccess({
          userId: result.userId,
          planName: result.planName,
        }).catch((err) => console.error("grant:", err));
      }

      await accrueCommissions(result.invoiceId).catch((err) =>
        console.error("commissions:", err),
      );
    }

    return { settled };
  });
}
