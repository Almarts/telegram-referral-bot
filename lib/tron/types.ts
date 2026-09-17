export interface UsdtTransfer {
  txHash: string;
  from: string;
  to: string;
  amountUsdt: string;       // 6dp string, e.g. "9.990000"
  blockTimestamp: number;   // unix seconds
  confirmed: boolean;
}

/**
 * Outcome of verifying a USDT transfer by txHash.
 *
 * Failure reasons are distinct on purpose. Collapsing them into a single `null`
 * made every failure (network blip, wrong address, not-yet-mined) look like
 * "transaction not found" to the user, which sent debugging in the wrong direction.
 */
export type VerifyUsdtResult =
  | { ok: true; from: string; to: string; amountUsdt: string }
  | {
      ok: false;
      reason: "not_found" | "not_confirmed" | "not_usdt" | "wrong_address" | "rpc_error";
      detail?: string;
    };

export interface TronService {
  /** Verify a TRX transfer by txHash — check it went to expectedTo and amount >= minTrxSun. */
  verifyTrxTransfer(txHash: string, expectedTo: string, minTrxSun: bigint): Promise<{
    confirmed: boolean;
    from: string;
    to: string;
    amountSun: bigint;
    blockTimestamp: number;
  } | null>;

  /** Verify a USDT transfer by txHash — check it went to expectedTo. */
  verifyUsdtTransfer(txHash: string, expectedTo: string): Promise<VerifyUsdtResult>;

  /** List USDT TRC20 transfers to an address. */
  listUsdtTransfersTo(address: string, opts?: { sinceMs?: number; limit?: number }): Promise<UsdtTransfer[]>;

  /** USDT TRC20 balance of an address (6dp string). */
  usdtBalance(address: string): Promise<string>;

  /** TRX balance of an address in SUN. */
  trxBalanceSun(address: string): Promise<bigint>;
}
