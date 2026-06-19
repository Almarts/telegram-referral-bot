export interface UsdtTransfer {
  txHash: string;
  from: string;
  to: string;
  amountUsdt: string;       // 6dp string, e.g. "9.990000"
  blockTimestamp: number;   // unix seconds
  confirmed: boolean;
}

export interface TronService {
  /** Verify a TRX transfer by txHash — check it went to expectedTo and amount >= minTrxSun. */
  verifyTrxTransfer(txHash: string, expectedTo: string, minTrxSun: bigint): Promise<{
    confirmed: boolean;
    from: string;
    to: string;
    amountSun: bigint;
  } | null>;

  /** Verify a USDT transfer by txHash — check it went to expectedTo. */
  verifyUsdtTransfer(txHash: string, expectedTo: string): Promise<{
    confirmed: boolean;
    from: string;
    to: string;
    amountUsdt: string;
  } | null>;

  /** List USDT TRC20 transfers to an address. */
  listUsdtTransfersTo(address: string, opts?: { sinceMs?: number; limit?: number }): Promise<UsdtTransfer[]>;

  /** USDT TRC20 balance of an address (6dp string). */
  usdtBalance(address: string): Promise<string>;

  /** TRX balance of an address in SUN. */
  trxBalanceSun(address: string): Promise<bigint>;
}
