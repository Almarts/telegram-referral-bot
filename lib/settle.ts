import { getDb } from "@/db/client";
import { invoices, subscriptions, subscriptionPlans } from "@/db/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { gte } from "@/lib/money";
import { getEnv } from "@/lib/env";
import { isUniqueViolation } from "@/lib/db-errors";

const ONE_TRX_SUN = 10_000_000n;

export type SettleStatus =
  | "paid"              // ✅ всё ок, доступ можно дать
  | "not_found"         // ❌ TXID не найден в блокчейне
  | "wrong_address"     // ❌ транзакция не на тот адрес
  | "underpaid"         // ❌ сумма меньше нужной
  | "too_old"           // ❌ транзакция старше заявки
  | "duplicate_txid"    // ❌ TXID уже использован
  | "no_invoice"        // ❌ нет открытого инвойса
  | "no_plan"           // ❌ план не найден
  ;

export interface SettleResult {
  status: SettleStatus;
  invoiceId: string;
  userId?: string;
  planName?: string;
  subscriptionId?: string;
  txHash?: string;
}

export function computeRenewalStart(now: Date, activeSubEndsAt?: Date): Date {
  if (activeSubEndsAt && activeSubEndsAt > now) {
    return activeSubEndsAt;
  }
  return now;
}

/**
 * Verify a TRX transaction by TXID and settle the invoice.
 * User sends TRX to the cold wallet and provides the TXID.
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
    return { status: "no_invoice", invoiceId };
  }

  // 2. Verify the TXID on-chain — check TRX transfer to cold wallet
  const txInfo = await tron.verifyTrxTransfer(txId, coldAddress, ONE_TRX_SUN);
  if (!txInfo) {
    // TXID doesn't exist or failed basic checks
    return { status: "not_found", invoiceId };
  }

  // 3. Check recipient address
  if (txInfo.to !== coldAddress) {
    return { status: "wrong_address", invoiceId };
  }

  // 4. Check that TX is NOT before invoice creation (prevents old TXID reuse)
  if (txInfo.blockTimestamp && txInfo.blockTimestamp < Math.floor(invoice.createdAt.getTime() / 1000)) {
    return { status: "too_old", invoiceId };
  }

  // 5. Check amount is sufficient
  if (txInfo.amountSun < ONE_TRX_SUN) {
    if (!invoice.hasPartialPayment) {
      await db
        .update(invoices)
        .set({ hasPartialPayment: true })
        .where(eq(invoices.id, invoiceId));
    }
    return { status: "underpaid", invoiceId };
  }

  // 6. Check if txHash already used by ANY invoice in the system (including non-open)
  const alreadyUsed = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.paidTxHash, txId))
    .limit(1);

  if (alreadyUsed.length > 0) {
    return { status: "duplicate_txid", invoiceId };
  }

  // 7. Check if user already has an active subscription
  const existingActiveSub = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, invoice.userId),
        eq(subscriptions.status, "active"),
        gt(subscriptions.endsAt, new Date()),
      ),
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (existingActiveSub) {
    return { status: "duplicate_txid", invoiceId };
  }

  // 8. Get plan for subscription duration
  const plan = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, invoice.planId))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!plan) {
    return { status: "no_plan", invoiceId };
  }

  // 9. Settle — paid
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
      status: "paid",
      invoiceId,
      userId: invoice.userId,
      planName: plan.name,
      subscriptionId: sub?.id,
      txHash: txId,
    };
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return { status: "duplicate_txid", invoiceId };
    }
    throw err;
  }
}
