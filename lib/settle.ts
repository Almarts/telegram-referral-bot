import { getDb } from "@/db/client";
import { invoices, subscriptions, subscriptionPlans } from "@/db/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { gte } from "@/lib/money";
import { getEnv } from "@/lib/env";
import { isUniqueViolation } from "@/lib/db-errors";

const ONE_TRX_SUN = 1_000_000n;

export interface SettleResult {
  settled: boolean;
  invoiceId: string;
  userId?: string;
  planName?: string;
  subscriptionId?: string;
  txHash?: string;
  underpayment?: boolean;
}

export function computeRenewalStart(now: Date, activeSubEndsAt?: Date): Date {
  if (activeSubEndsAt && activeSubEndsAt > now) {
    return activeSubEndsAt;
  }
  return now;
}

/**
 * Verify a TRX transaction by TXID and settle the invoice.
 * User sends 1 TRX to the cold wallet and provides the TXID.
 */
export async function settleByTxId(invoiceId: string, txId: string): Promise<SettleResult> {
  const db = getDb();
  const tron = getTron();
  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;

  // 1. Fetch pending invoice
  const invoice = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "open")))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!invoice) {
    return { settled: false, invoiceId };
  }

  // 2. Verify the TXID on-chain — check TRX transfer to cold wallet
  const txInfo = await tron.verifyTrxTransfer(txId, coldAddress, ONE_TRX_SUN);
  if (!txInfo) {
    return { settled: false, invoiceId };
  }

  // 3. Check amount is sufficient (at least 1 TRX = 1_000_000 SUN)
  if (txInfo.amountSun < ONE_TRX_SUN) {
    if (!invoice.hasPartialPayment) {
      await db
        .update(invoices)
        .set({ hasPartialPayment: true })
        .where(eq(invoices.id, invoiceId));
    }
    return { settled: false, invoiceId, underpayment: true };
  }

  // 4. Check if txHash already used (idempotency)
  const alreadyUsed = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.paidTxHash, txId))
    .limit(1);

  if (alreadyUsed.length > 0) {
    return { settled: false, invoiceId };
  }

  // 5. Get plan for subscription duration
  const plan = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, invoice.planId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!plan) {
    return { settled: false, invoiceId };
  }

  // 6. Settle
  try {
    const now = new Date();

    const existingActive = await db
      .select({ endsAt: subscriptions.endsAt })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, invoice.userId),
          eq(subscriptions.status, "active"),
          gt(subscriptions.endsAt, now),
        ),
      )
      .orderBy(desc(subscriptions.endsAt))
      .limit(1)
      .then((r) => r[0] ?? null);

    const startsAt = computeRenewalStart(now, existingActive?.endsAt ?? undefined);
    const endsAt = new Date(startsAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    const [sub] = await db
      .insert(subscriptions)
      .values({
        userId: invoice.userId,
        invoiceId: invoice.id,
        startsAt,
        endsAt,
        channelId: getEnv().DEFAULT_CHANNEL_ID,
        status: "active",
      })
      .returning();

    await db
      .update(invoices)
      .set({
        status: "paid",
        paidTxHash: txId,
        paidAt: now,
      })
      .where(eq(invoices.id, invoiceId));

    return {
      settled: true,
      invoiceId,
      userId: invoice.userId,
      planName: plan.name,
      subscriptionId: sub?.id,
      txHash: txId,
    };
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return { settled: false, invoiceId };
    }
    throw err;
  }
}
