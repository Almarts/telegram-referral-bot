import { getDb } from "@/db/client";
import { invoices, subscriptions, subscriptionPlans } from "@/db/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { isUniqueViolation } from "@/lib/db-errors";
import { gte } from "@/lib/money";

export type SettleStatus =
  | "paid"              // ✅ всё ок, доступ можно дать
  | "not_found"         // ❌ TXID не найден в блокчейне
  | "wrong_address"     // ❌ транзакция не на тот адрес
  | "not_usdt"          // ❌ транзакция не является переводом USDT
  | "rpc_error"         // ❌ не удалось опросить блокчейн (сеть/лимит) — стоит повторить
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

export type VerifyUsdtResult =
  | { ok: true; from: string; to: string; amountUsdt: string }
  | { ok: false; reason: "not_found" | "not_confirmed" | "not_usdt" | "wrong_address" | "rpc_error"; detail?: string };

export function computeRenewalStart(now: Date, activeSubEndsAt?: Date): Date {
  if (activeSubEndsAt && activeSubEndsAt > now) {
    return activeSubEndsAt;
  }
  return now;
}

/**
 * Check a TXID on TronGrid — verify a USDT TRC20 transfer to the cold wallet
 * and confirm it meets the invoice amount. Returns a detailed failure reason,
 * or the parsed tx info if successful.
 */
async function checkTxidDirect(
  txId: string,
  coldAddress: string,
  invoiceCreatedAt: Date,
  expectedAmountUsdt: string,
): Promise<
  | { ok: true; from: string; to: string; amountUsdt: string; blockTimestamp: number }
  | { ok: false; reason: "not_found" | "wrong_address" | "underpaid" | "too_old" | "not_usdt" | "rpc_error"; detail?: string }
> {
  try {
    const { getTron } = await import("./tron");
    const verifyResult = await getTron().verifyUsdtTransfer(txId, coldAddress);

    if (verifyResult.ok === false) {
      // Preserve the real reason: "not found" is only one of several failures.
      // A TronGrid outage must not be reported to the user as "wrong TXID".
      return {
        ok: false,
        reason: verifyResult.reason === "not_confirmed" ? "not_found" : verifyResult.reason,
        detail: verifyResult.detail ?? "USDT transfer could not be verified",
      };
    }

    // Recipient is verified inside verifyUsdtTransfer (returns null if not to cold wallet).

    // Amount check — full invoice amount required
    if (!gte(verifyResult.amountUsdt, expectedAmountUsdt)) {
      return {
        ok: false,
        reason: "underpaid",
        detail: `Received ${verifyResult.amountUsdt} USDT, required ${expectedAmountUsdt} USDT`,
      };
    }

    // Too-old check: attempt to read the block timestamp for the tx.
    // USDT verify doesn't return it directly, so only apply a loose guard.
    // (Invoice amounts now vary per plan; most users pay right after creating the invoice.)
    let blockTimestamp = 0;
    try {
      const apiKey = getEnv().TRONGRID_API_KEY;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["TRON-PRO-API-KEY"] = apiKey;
      const infoRes = await fetch("https://api.trongrid.io/wallet/gettransactioninfobyid", {
        method: "POST",
        headers,
        body: JSON.stringify({ value: txId }),
        signal: AbortSignal.timeout(10_000),
      });
      const txInfo = await infoRes.json() as { blockTimeStamp?: number };
      if (txInfo.blockTimeStamp) {
        blockTimestamp = Number(txInfo.blockTimeStamp) / 1000;
        const invoiceTs = Math.floor(invoiceCreatedAt.getTime() / 1000);
        if (blockTimestamp < invoiceTs) {
          return {
            ok: false,
            reason: "too_old",
            detail: `TX from ${new Date(blockTimestamp * 1000).toISOString()}, invoice created ${invoiceCreatedAt.toISOString()}`,
          };
        }
      }
    } catch {
      // Timestamp fetch failed — allow through (secondary check, best-effort)
    }

    return {
      ok: true,
      from: verifyResult.from,
      to: verifyResult.to,
      amountUsdt: verifyResult.amountUsdt,
      blockTimestamp,
    };
  } catch (err) {
    return { ok: false, reason: "not_found", detail: `TronGrid error: ${err}` };
  }
}

export async function settleByTxId(invoiceId: string, txId: string): Promise<SettleResult> {
  const db = getDb();

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

  // NOTE: the expected recipient comes from the INVOICE, not from env.
  //
  // The invoice stores the address that was actually shown to the user when it
  // was created. Reading it back here means rotating TRON_COLD_WALLET_ADDRESS
  // never invalidates invoices that are still open — an invoice issued before
  // the rotation stays payable to the address the user was told about.
  //
  // Fall back to env only for legacy rows that somehow lack a deposit address.
  const coldAddress = invoice.depositAddress || getEnv().TRON_COLD_WALLET_ADDRESS;

  // 2. Check if txHash already used by ANY invoice in the system (including non-open)
  // Do this FIRST — if it's in our DB, it was already used regardless of blockchain state
  const alreadyUsed = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.paidTxHash, txId))
    .limit(1);

  if (alreadyUsed.length > 0) {
    return { status: "duplicate_txid", invoiceId };
  }

  // 3. Removed: check for existing active sub — handled in settlement step 9 below (renew)

  // 4. Check TXID on blockchain with detailed diagnostics
  const check = await checkTxidDirect(txId, coldAddress, invoice.createdAt, invoice.amountUsdt);

  if (check.ok === false) {
    return {
      status: check.reason,
      invoiceId,
    };
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
