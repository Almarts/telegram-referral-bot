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
}

// ── Pure decision ──────────────────────────────────────────────────────────

export function sweepInvoice(ctx: SweepContext): SweepDecision {
  if (ctx.usdtBalance === "0.000000" || ctx.usdtBalance === "0") {
    return { swept: true, txHash: null };
  }
  // If the deposit address has USDT but no TRX (unactivated), we still try
  // to send USDT. TronGrid's broadcast will use feeLimit to cover energy.
  return { swept: false, txHash: null };
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

      // Has USDT — send invoice amount to cold wallet
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
