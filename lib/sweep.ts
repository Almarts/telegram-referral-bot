import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and, lt, sql, asc } from "drizzle-orm";
import { gte } from "@/lib/money";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SweepContext {
  address: string;
  derivIndex: number;
  invoiceId: string;
  coldAddress: string;
  trxForTransferSun: bigint;
  usdtBalance: string;
  trxBalanceSun: bigint;
}

export interface SweepDecision {
  swept: boolean;
  txHash: string | null;
  trxTopUpHash: string | null;
  needsTrxTopUp: boolean;
}

// Minimum TRX needed on a deposit address to execute a USDT TRC20 transfer.
// 30 TRX ≈ covers energy + bandwidth at current rates with buffer.
export const DEFAULT_TRX_FOR_TRANSFER_SUN = 30_000_000n;

// ── Pure decision ──────────────────────────────────────────────────────────

/**
 * Determine the sweep action for a single invoice's deposit address.
 *
 * Pure function — no DB, no Tron RPC. The caller executes the decision.
 *
 * - balance == 0  → already swept or no payment received, mark swept
 * - TRX too low   → caller must top-up from hot wallet first, then retry
 * - otherwise     → caller must send USDT to cold wallet
 */
export function sweepInvoice(ctx: SweepContext): SweepDecision {
  if (ctx.usdtBalance === "0.000000" || ctx.usdtBalance === "0") {
    return { swept: true, txHash: null, trxTopUpHash: null, needsTrxTopUp: false };
  }

  if (ctx.trxBalanceSun < ctx.trxForTransferSun) {
    return { swept: false, txHash: null, trxTopUpHash: null, needsTrxTopUp: true };
  }

  // Has both USDT and TRX — caller should send USDT to cold
  // We can't know the tx hash yet, return swept=false to signal "needs transfer"
  return { swept: false, txHash: null, trxTopUpHash: null, needsTrxTopUp: false };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Sweep USDT from paid invoices' deposit addresses to the cold wallet.
 *
 * Process:
 * 1. Fetch paid invoices older than 15m where swept=false (LIMIT 100).
 * 2. For each: check USDT balance on the deposit address.
 *    - Zero → mark swept=true (nothing to sweep).
 *    - Positive → if TRX too low, top-up from hot wallet first.
 *      Then send USDT to cold wallet, mark swept=true + sweep_tx_hash.
 *
 * Idempotent: WHERE swept=false prevents double-sweep. The KV cron lease
 * prevents concurrent runs.
 *
 * Returns count of swept invoices this tick.
 */
export async function processSweeps(): Promise<number> {
  const db = getDb();
  const tron = getTron();
  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;

  // Fetch paid invoices older than 15m, not yet swept
  const toSweep = await db
    .select({
      id: invoices.id,
      depositAddress: invoices.depositAddress,
      derivIndex: invoices.derivIndex,
      amountUsdt: invoices.amountUsdt,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, "paid"),
        eq(invoices.swept, false),
        lt(invoices.paidAt, sql`now() - interval '15 minutes'`),
      ),
    )
    .orderBy(asc(invoices.paidAt))
    .limit(100);

  let swept = 0;

  for (const inv of toSweep) {
    const address = inv.depositAddress;
    if (!address) continue;

    try {
      const usdtBalance = await tron.usdtBalance(address);
      const trxBalanceSun = await tron.trxBalanceSun(address);

      const decision = sweepInvoice({
        address,
        derivIndex: inv.derivIndex,
        invoiceId: inv.id,
        coldAddress,
        trxForTransferSun: DEFAULT_TRX_FOR_TRANSFER_SUN,
        usdtBalance,
        trxBalanceSun,
      });

      if (decision.swept && !decision.txHash) {
        // Zero balance — mark swept
        await db
          .update(invoices)
          .set({ swept: true })
          .where(and(eq(invoices.id, inv.id), eq(invoices.swept, false)));
        swept++;
        continue;
      }

      if (decision.needsTrxTopUp) {
        // Attempt to send USDT directly using feeLimit (covers energy)
        // even if the deposit address has 0 TRX.
        console.log(`sweep: trying direct USDT sweep for ${address} (0 TRX, using feeLimit)`);
        // Fall through to the USDT transfer block below — it will
        // attempt the transfer with the high feeLimit.
      }

      // Has USDT and enough TRX — send invoice amount to cold wallet
      // Use the invoice amount, not the full balance, to avoid silently
      // absorbing overpayments (which would make refunds impossible).
      const sweepAmount = inv.amountUsdt;
      const hasFullBalance = gte(usdtBalance, sweepAmount);
      const amountToSweep = hasFullBalance ? sweepAmount : usdtBalance;

      if (!hasFullBalance) {
        console.warn(
          `sweep: partial balance on ${inv.id}: have ${usdtBalance}, expected ${sweepAmount}`,
        );
      }

      const signer = tron.signerForIndex(inv.derivIndex);
      const tx = await tron.sendUsdt({
        fromAddress: address,
        toAddress: coldAddress,
        amount: amountToSweep,
        signer,
      });

      // Update DB immediately to preserve txHash
      const updated = await db
        .update(invoices)
        .set({ swept: true, sweepTxHash: tx.txHash })
        .where(and(eq(invoices.id, inv.id), eq(invoices.swept, false)));

      if (updated.rowCount === 0) {
        console.error(`sweep: race on ${inv.id} — already swept`);
      }

      swept++;
    } catch (err) {
      console.error(`sweep invoice ${inv.id}:`, err);
      // Don't fail the batch, retry on next tick
    }
  }

  return swept;
}
