export interface Signer {
  readonly address: string;
  sign(rawTx: unknown): Promise<{ txId: string }>;
}

export interface UsdtTransfer {
  txHash: string;
  from: string;
  to: string;
  amountUsdt: string;       // 6dp string, e.g. "9.990000"
  blockTimestamp: number;   // unix seconds
  confirmed: boolean;
}

export interface TronService {
  /** Derive a TRC20 deposit address from the BIP32 path m/44'/195'/0'/0/{index}. */
  deriveDepositAddress(index: number): { address: string };

  /** Return a signer for the deposit address at the given BIP32 index. */
  signerForIndex(index: number): Signer;

  /** Return a signer for the hot wallet (commission payouts). */
  hotSigner(): Signer;

  /** List USDT TRC20 transfers to an address. */
  listUsdtTransfersTo(address: string, opts?: { sinceMs?: number; limit?: number }): Promise<UsdtTransfer[]>;

  /** USDT TRC20 balance of an address (6dp string). */
  usdtBalance(address: string): Promise<string>;

  /** TRX balance of an address in SUN. */
  trxBalanceSun(address: string): Promise<bigint>;

  /** Broadcast a USDT TRC20 transfer. Returns the tx hash. */
  sendUsdt(opts: {
    fromAddress: string;
    toAddress: string;
    amount: string;
    signer: Signer;
  }): Promise<{ txHash: string }>;

  /** Broadcast a TRX transfer, amount in SUN. Returns the tx hash. */
  sendTrx(opts: {
    fromAddress: string;
    toAddress: string;
    amountSun: bigint;
    signer: Signer;
  }): Promise<{ txHash: string }>;
}
