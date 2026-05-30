import { getDb } from "@/db/client";
import { invoices, subscriptions, subscriptionPlans } from "@/db/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { gte } from "@/lib/money";
import { getEnv } from "@/lib/env";
import { isUniqueViolation } from "@/lib/db-errors";

export interface SettleResult {
  settled: boolean;
  invoiceId: string;
  userId?: string;
  planName?: string;
  subscriptionId?: string;
  txHash?: string;
  underpayment?: boolean;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Compute the starts_at date for a renewed subscription.
 *
 * Stacking rule: if the user has an active subscription that hasn't expired
 * yet, the new sub starts when the old one ends (no lost time). Otherwise,
 * it starts now (grace window = 0 per locked decision §2.9).
 */
export function computeRenewalStart(
  now: Date,
  activeSubEndsAt?: Date,
): Date {
  if (activeSubEndsAt && activeSubEndsAt > now) {
    return activeSubEndsAt;
  }
  return now;
}

/**
 * Check whether an invoice has been paid and settle it if so.
 *
 * For each pending invoice:
 * 1. Poll TronGrid for transfers to the deposit address.
 * 2. If any confirmed transfer >= invoice amount and txHash not already used -> mark paid.
 * 3. Create a subscription row (active, timestamped from now).
 *
 * Idempotent: the UNIQUE constraint on invoices.paid_tx_hash prevents double-settlement.
 * Underpayments are flagged but not settled.
 */
export async function settleIfPaid(invoiceId: string): Promise<SettleResult> {
  const db = getDb();
  const tron = getTron();

  // 1. Fetch invoice (only pending ones)
  const invoice = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "open")))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!invoice || !invoice.depositAddress) {
    return { settled: false, invoiceId };
  }

  // 2. Get plan for subscription duration
  const plan = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, invoice.planId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!plan) {
    return { settled: false, invoiceId };
  }

  // 3. Poll transfers
  const transfers = await tron.listUsdtTransfersTo(invoice.depositAddress, {
    sinceMs: invoice.createdAt.getTime(),
  });

  // 4. Find first confirmed transfer that meets or exceeds the invoice amount
  const matching = transfers.find(
    (t) => t.confirmed && gte(t.amountUsdt, invoice.amountUsdt),
  );

  if (!matching) {
    // Check for underpayment
    const hasAny = transfers.some((t) => t.confirmed);
    if (hasAny) {
      // Flag underpayment (non-blocking)
      if (!invoice.hasPartialPayment) {
        await db
          .update(invoices)
          .set({ hasPartialPayment: true })
          .where(eq(invoices.id, invoiceId));
      }
      return { settled: false, invoiceId, underpayment: true };
    }
    return { settled: false, invoiceId };
  }

  // 5. Check if txHash was already used to settle another invoice
  const alreadyUsed = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.paidTxHash, matching.txHash))
    .limit(1);

  if (alreadyUsed.length > 0) {
    // Another invoice already consumed this txHash (UNIQUE constraint would also block this)
    return { settled: false, invoiceId };
  }

  // 6. Settle: update invoice + create subscription
  try {
    const now = new Date();

    // Check for an existing active subscription for stacking
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
    const endsAt = new Date(
      startsAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000,
    );

    // Create subscription FIRST — if this fails, invoice stays pending and cron retries.
    // This avoids the irrecoverable state where invoice is paid but no subscription exists.
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

    // Mark invoice paid only after subscription row exists
    await db
      .update(invoices)
      .set({
        status: "paid",
        paidTxHash: matching.txHash,
        paidAt: now,
      })
      .where(eq(invoices.id, invoiceId));

    return {
      settled: true,
      invoiceId,
      userId: invoice.userId,
      planName: plan.name,
      subscriptionId: sub?.id,
      txHash: matching.txHash,
    };
  } catch (err: unknown) {
    // UNIQUE constraint on paid_tx_hash catches double-settlement
    if (isUniqueViolation(err)) {
      return { settled: false, invoiceId };
    }
    throw err;
  }
}
