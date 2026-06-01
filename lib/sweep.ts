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
  usdtBalance: string;
  trxBalanceSun: bigint;
}

export interface SweepDecision {
  swept: boolean;
  txHash: string | null;
  needsTrxTopUp: boolean;
}

// Minimum TRX needed on a deposit address to execute a USDT TRC20 transfer.
export const DEFAULT_TRX_FOR_TRANSFER_SUN = 30_000_000n;

// ── Pure decision ──────────────────────────────────────────────────────────

export function sweepInvoice(ctx: SweepContext): SweepDecision {
  if (ctx.usdtBalance === "0.000000" || ctx.usdtBalance === "0") {
    return { swept: true, txHash: null, needsTrxTopUp: false };
  }

  if (ctx.trxBalanceSun < DEFAULT_TRX_FOR_TRANSFER_SUN) {
    return { swept: false, txHash: null, needsTrxTopUp: true };
  }

  return { swept: false, txHash: null, needsTrxTopUp: false };
}

/** Check if a transaction actually exists on chain via TronGrid. */
async function txExistsOnChain(txHash: string): Promise<boolean> {
  try {
    const url = `https://api.trongrid.io/v1/transactions/${txHash}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { data?: unknown[] };
    return Array.isArray(body.data) && body.data.length > 0;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function processSweeps(): Promise<number> {
  const db = getDb();
  const tron = getTron();
  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;

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
        usdtBalance,
        trxBalanceSun,
      });

      if (decision.swept && !decision.txHash) {
        await db
          .update(invoices)
          .set({ swept: true })
          .where(and(eq(invoices.id, inv.id), eq(invoices.swept, false)));
        swept++;
        continue;
      }

      if (decision.needsTrxTopUp) {
        const hotSigner = tron.hotSigner();
        const topUp = await tron.sendTrx({
          fromAddress: hotSigner.address,
          toAddress: address,
          amountSun: DEFAULT_TRX_FOR_TRANSFER_SUN,
          signer: hotSigner,
        });
        console.log(`sweep: topped up ${topUp.txHash} for ${address}`);
        continue;
      }

      // Has USDT and enough TRX — send invoice amount to cold wallet
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

      // Verify the transaction actually landed on chain
      const exists = await txExistsOnChain(tx.txHash);
      if (!exists) {
        console.error(
          `sweep: tx ${tx.txHash} for ${inv.id} not found on chain after broadcast — skipping DB update`,
        );
        continue;
      }

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
    }
  }

  return swept;
}
