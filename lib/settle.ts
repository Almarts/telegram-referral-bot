import { getDb } from "@/db/client";
import { invoices, subscriptions, subscriptionPlans } from "@/db/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { isUniqueViolation } from "@/lib/db-errors";
import { createHash } from "node:crypto";

const TRONGRID = "https://api.trongrid.io";
const ONE_TRX_SUN = 10_000_000n;

// Base58 alphabet for Tron address decoding
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function hexToBase58(hex: string): string {
  let h = hex;
  if (h.startsWith("0x")) h = h.slice(2);
  if (!h.startsWith("41")) h = "41" + h;
  const buf = Buffer.from(h, "hex");
  const full = Buffer.concat([buf, createHash("sha256").update(createHash("sha256").update(buf).digest()).digest().slice(0, 4)]);
  let num = BigInt("0x" + full.toString("hex"));
  let result = "";
  while (num > 0n) {
    result = B58[Number(num % 58n)] + result;
    num /= 58n;
  }
  for (const b of buf) {
    if (b === 0) result = B58[0] + result;
    else break;
  }
  return result;
}

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
/**
 * Check a TXID on TronGrid directly and diagnose why it fails.
 * Returns a detailed failure reason, or the parsed tx info if successful.
 */
async function checkTxidDirect(
  txId: string,
  coldAddress: string,
  invoiceCreatedAt: Date,
): Promise<
  | { ok: true; from: string; to: string; amountSun: bigint; blockTimestamp: number }
  | { ok: false; reason: "not_found" | "wrong_address" | "underpaid" | "too_old"; detail?: string }
> {
  const apiKey = getEnv().TRONGRID_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers["TRON-PRO-API-KEY"] = apiKey;

  try {
    // Step 1: Check tx exists on chain
    const txRes = await fetch("https://api.trongrid.io/wallet/gettransactionbyid", {
      method: "POST",
      headers,
      body: JSON.stringify({ value: txId }),
      signal: AbortSignal.timeout(10_000),
    });
    const tx = await txRes.json() as Record<string, unknown>;
    if (!tx || !tx.txID) {
      return { ok: false, reason: "not_found", detail: "TXID not found on chain" };
    }

    // Step 2: Check it's confirmed
    const infoRes = await fetch("https://api.trongrid.io/wallet/gettransactioninfobyid", {
      method: "POST",
      headers,
      body: JSON.stringify({ value: txId }),
      signal: AbortSignal.timeout(10_000),
    });
    const txInfo = await infoRes.json() as Record<string, unknown>;
    if (!txInfo || !txInfo.blockNumber) {
      return { ok: false, reason: "not_found", detail: "Transaction not confirmed" };
    }

    const rawData = tx.raw_data as Record<string, unknown> | undefined;
    const contracts = rawData?.contract as Array<Record<string, unknown>> | undefined;
    if (!contracts?.length) {
      return { ok: false, reason: "not_found", detail: "No contracts in tx" };
    }

    const value = contracts[0]?.parameter?.value as Record<string, unknown> | undefined;
    if (!value) {
      return { ok: false, reason: "not_found", detail: "No value in contract" };
    }

    const toHex = String(value.to_address ?? "");
    const amountSun = BigInt(String(value.amount ?? "0"));
    const blockTimestamp = Number(txInfo.blockTimeStamp ?? 0) / 1000;

    // Decode address
    const { getTronWeb } = await import("./tron/tronweb-client");
    const tw = getTronWeb(apiKey);
    let toAddr: string;
    try {
      toAddr = tw.address.fromHex(toHex);
    } catch {
      toAddr = toHex;
    }

    // Check recipient
    if (toAddr !== coldAddress) {
      return {
        ok: false,
        reason: "wrong_address",
        detail: `Sent to ${toAddr}, expected ${coldAddress}`,
      };
    }

    // Check amount
    if (amountSun < 10_000_000n) {
      return {
        ok: false,
        reason: "underpaid",
        detail: `Received ${Number(amountSun) / 1_000_000} TRX, minimum 10 TRX`,
      };
    }

    // Check timestamp
    const invoiceTs = Math.floor(invoiceCreatedAt.getTime() / 1000);
    if (blockTimestamp && blockTimestamp < invoiceTs) {
      return {
        ok: false,
        reason: "too_old",
        detail: `TX from ${new Date(blockTimestamp * 1000).toISOString()}, invoice created ${invoiceCreatedAt.toISOString()}`,
      };
    }

    let fromAddr: string;
    try {
      fromAddr = tw.address.fromHex(String(tx.owner_address ?? tx.ownerAddress ?? ""));
    } catch {
      fromAddr = String(tx.owner_address ?? tx.ownerAddress ?? "");
    }

    return { ok: true, from: fromAddr, to: toAddr, amountSun, blockTimestamp };
  } catch (err) {
    return { ok: false, reason: "not_found", detail: `TronGrid error: ${err}` };
  }
}

export async function settleByTxId(invoiceId: string, txId: string): Promise<SettleResult> {
  const db = getDb();
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

  // 3. Check if user already has an active subscription (also indicates previous payment)
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

  // 4. Check TXID on blockchain with detailed diagnostics
  const check = await checkTxidDirect(txId, coldAddress, invoice.createdAt);

  if (!check.ok) {
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
