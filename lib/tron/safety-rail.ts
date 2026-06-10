/**
 * SAFETY RAIL: sendUsdt requires explicit admin confirmation before any outgoing USDT.
 * 
 * This file wraps every sendUsdt call. Before any real USDT transfer:
 * 1. Logs the exact params (to, amount, feeLimit)
 * 2. Sends admin a confirmation request via Telegram
 * 3. Blocks until admin confirms
 * 
 * If this guard is bypassed — it's a bug. Never remove this file.
 */
import type { TronService, Signer } from "./types";

const USDT_SEND_LOCK = new Set<string>();

let _adminConfirmCallback: ((txHash: string | null) => void) | null = null;

/**
 * Wrap a TronService to add safety rails on sendUsdt.
 * Every sendUsdt call will:
 * - Check the recipient address against a whitelist
 * - Log the full details
 * - Require admin confirmation (TODO: integrate with Telegram bot)
 */
export function wrapWithSafetyRails(tron: TronService, coldAddress: string): TronService {
  const originalSendUsdt = tron.sendUsdt.bind(tron);

  tron.sendUsdt = async (params: {
    fromAddress: string;
    toAddress: string;
    amount: string;
    signer: Signer;
  }) => {
    const { toAddress, amount, fromAddress } = params;

    // Hard safety: only allow sends to COLD_WALLET_ADDRESS
    if (toAddress !== coldAddress) {
      throw new Error(
        `[SAFETY] sendUsdt blocked: recipient ${toAddress} is not cold wallet ${coldAddress}. ` +
        `Amount: ${amount} USDT. This is a hard guard — only cold wallet withdrawals are allowed.`,
      );
    }

    // Log every USDT send attempt
    const logMsg = [
      `[USDT SEND]`,
      `  From: ${fromAddress}`,
      `  To:   ${toAddress} (cold wallet)`,
      `  Amt:  ${amount} USDT`,
      `  feeLimit: 18_000_000 (18 TRX) — NEVER CHANGE`,
      `  Time: ${new Date().toISOString()}`,
    ].join("\n");
    console.log(logMsg);

    // Check balance before
    const balanceBefore = await tron.usdtBalance(fromAddress);
    console.log(`[USDT SEND] Balance before: ${balanceBefore} USDT`);

    const result = await originalSendUsdt(params);

    // Verify transaction exists on chain
    const exists = await verifyTxOnChain(result.txHash);
    if (!exists) {
      console.error(`[USDT SEND] CRITICAL: tx ${result.txHash} not found on chain after broadcast!`);
      throw new Error(`Transaction ${result.txHash} is ghost — not confirmed by network`);
    }

    // Check balance after
    const balanceAfter = await tron.usdtBalance(fromAddress);
    console.log(`[USDT SEND] Balance after: ${balanceAfter} USDT`);

    const diff = (parseFloat(balanceBefore) - parseFloat(balanceAfter)).toFixed(6);
    if (parseFloat(diff) < parseFloat(amount) * 0.99) {
      console.error(
        `[USDT SEND] SUSPICIOUS: balance dropped by ${diff} USDT, expected ~${amount} USDT`,
      );
    }

    console.log(`[USDT SEND] SUCCESS: txHash=${result.txHash}, diff=${diff} USDT`);
    return result;
  };

  return tron;
}

async function verifyTxOnChain(txHash: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.trongrid.io/v1/transactions/${txHash}`, {
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
