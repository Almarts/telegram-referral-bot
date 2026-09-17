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

    // Fetch pending invoices (not expired yet).
    // Each invoice carries the address the user was actually shown, so rotating
    // TRON_COLD_WALLET_ADDRESS does not strand invoices that are still open.
    const pending = await db
      .select({
        id: invoices.id,
        amountUsdt: invoices.amountUsdt,
        depositAddress: invoices.depositAddress,
      })
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

    // Group by deposit address: one blockchain lookup per distinct address
    // instead of assuming every invoice points at the current cold wallet.
    const byAddress = new Map<string, typeof pending>();
    for (const inv of pending) {
      const addr = inv.depositAddress || coldAddress;
      if (!byAddress.has(addr)) byAddress.set(addr, []);
      byAddress.get(addr)!.push(inv);
    }

    let settled = 0;

    for (const [addr, invoicesForAddr] of Array.from(byAddress.entries())) {
      const transfers = await tron.listUsdtTransfersTo(addr, {
        sinceMs: Date.now() - 30 * 60 * 1000, // last 30 min
      });

      if (transfers.length === 0) continue;

      for (const inv of invoicesForAddr) {
        // Find a matching transfer
        const match = transfers.find(
          (t) => t.confirmed && gte(t.amountUsdt, inv.amountUsdt),
        );
        if (!match) continue;

        const result = await settleByTxId(inv.id, match.txHash);
        if (result.status !== "paid") continue;
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
    }

    return { settled };
  });
}
