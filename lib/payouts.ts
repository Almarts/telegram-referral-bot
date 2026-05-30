import { getDb } from "@/db/client";
import {
  commissionLedger,
  payoutBatches,
  commissionConfig,
  opsKillSwitch,
  users,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { add, gte } from "@/lib/money";
import { getEnv } from "@/lib/env";
import { checkPayoutRateLimit } from "@/lib/breakers";

export interface PayoutResult {
  processed: number;
  totalPaidOut: string;
  skipped: number;
}

const EMPTY_RESULT: PayoutResult = {
  processed: 0,
  totalPaidOut: "0.000000",
  skipped: 0,
};

export async function processPayouts(): Promise<PayoutResult> {
  const db = getDb();
  const tron = getTron();
  const env = getEnv();

  // 1. Check kill switch
  const ks = await db
    .select({ payoutDisabled: opsKillSwitch.payoutDisabled })
    .from(opsKillSwitch)
    .limit(1)
    .then((r) => r[0]);

  if (ks?.payoutDisabled) return EMPTY_RESULT;

  // 1b. Rate limit check (sliding window)
  const rateOk = await checkPayoutRateLimit();
  if (!rateOk) return EMPTY_RESULT;

  // 2. Promote accrued → payable
  await db
    .update(commissionLedger)
    .set({ status: "payable" })
    .where(
      and(
        eq(commissionLedger.status, "accrued"),
        sql`${commissionLedger.unlockAt} <= now()`,
      ),
    );

  // 3. Get config
  const config = await db
    .select()
    .from(commissionConfig)
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!config) return EMPTY_RESULT;

  // 4. Group payable rows by beneficiary
  const payable = await db
    .select({
      beneficiaryId: commissionLedger.beneficiaryId,
      total: sql<string>`SUM(${commissionLedger.amountUsdt})::text`,
    })
    .from(commissionLedger)
    .where(eq(commissionLedger.status, "payable"))
    .groupBy(commissionLedger.beneficiaryId);

  let processed = 0;
  let totalPaidOut = "0.000000";
  let skipped = 0;

  for (const group of payable) {
    // 5. Check threshold
    if (!gte(group.total, config.minPayoutUsdt)) {
      skipped++;
      continue;
    }

    // 6. Check payout address + cooling-off
    const beneficiary = await db
      .select({
        id: users.id,
        payoutAddress: users.payoutAddress,
        payoutAddressChangedAt: users.payoutAddressChangedAt,
      })
      .from(users)
      .where(eq(users.id, group.beneficiaryId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!beneficiary?.payoutAddress) { skipped++; continue; }
    if (
      beneficiary.payoutAddressChangedAt &&
      Date.now() - beneficiary.payoutAddressChangedAt.getTime() < 24 * 3600 * 1000
    ) {
      skipped++;
      continue;
    }

    // 7. Circuit breaker: max per tx
    if (env.MAX_PAYOUT_PER_TX_USDT && gte(group.total, env.MAX_PAYOUT_PER_TX_USDT)) {
      console.error(`Payout ${group.total} exceeds MAX_PAYOUT_PER_TX_USDT ${env.MAX_PAYOUT_PER_TX_USDT}, disabling payouts`);
      await db.update(opsKillSwitch).set({ payoutDisabled: true, reason: "MAX_PAYOUT_PER_TX_USDT exceeded" }).where(eq(opsKillSwitch.id, 1));
      break;
    }

    // 8. Create batch (pending)
    const [batch] = await db
      .insert(payoutBatches)
      .values({
        beneficiaryId: group.beneficiaryId,
        amountUsdt: group.total,
        status: "pending",
      })
      .returning();

    if (!batch) continue;

    // 9. Broadcast USDT FIRST — only mark commissions paid after success
    try {
      const { txHash } = await tron.sendUsdt({
        fromAddress: tron.hotSigner().address,
        toAddress: beneficiary.payoutAddress,
        amount: group.total,
        signer: tron.hotSigner(),
      });

      // Mark batch as broadcast
      await db
        .update(payoutBatches)
        .set({ txHash, status: "broadcast", broadcastAt: new Date() })
        .where(eq(payoutBatches.id, batch.id));

      // Only now mark commission ledger rows as paid
      await db
        .update(commissionLedger)
        .set({ status: "paid", batchId: batch.id, paidTxHash: txHash })
        .where(
          and(
            eq(commissionLedger.beneficiaryId, group.beneficiaryId),
            eq(commissionLedger.status, "payable"),
          ),
        );

      processed++;
      totalPaidOut = add(totalPaidOut, group.total);
    } catch (err) {
      console.error(`Payout broadcast failed for batch ${batch.id}:`, err);
      // Batch and commission rows stay as pending/payable, retried next tick
    }
  }

  return { processed, totalPaidOut, skipped };
}
