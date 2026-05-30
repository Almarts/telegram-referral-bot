import type { TronService, UsdtTransfer } from "./types";
import { add, sub } from "@/lib/money";

export interface FakeTronControls {
  __setUsdtBalance(address: string, amount: string): void;
  __setTrxBalance(address: string, sun: bigint): void;
  __injectTransfer(toAddress: string, transfer: UsdtTransfer): void;
  readonly __sendUsdtCount: number;
  readonly __sendTrxCount: number;
}

function fakeAddress(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(33, "0")}`;
}

export function createFakeTron(): TronService & { controls: FakeTronControls } {
  const usdtBalances = new Map<string, string>();
  const trxBalances = new Map<string, bigint>();
  const transferLog = new Map<string, UsdtTransfer[]>();
  let nextTxN = 0;
  let sendUsdtCount = 0;
  let sendTrxCount = 0;

  function makeTxHash(): string {
    return `0x${String(++nextTxN).padStart(40, "0")}`;
  }

  const service: TronService = {
    deriveDepositAddress(index: number) {
      return { address: fakeAddress("T", index) };
    },

    signerForIndex(index: number) {
      const address = fakeAddress("T", index);
      return {
        address,
        sign: async () => ({ txId: makeTxHash() }),
      };
    },

    hotSigner() {
      const address = fakeAddress("H", 0);
      return {
        address,
        sign: async () => ({ txId: makeTxHash() }),
      };
    },

    async listUsdtTransfersTo(address: string, opts?: { sinceMs?: number; limit?: number }) {
      const all = transferLog.get(address) ?? [];
      let filtered = all.filter((t) => t.confirmed);
      const sinceMs = opts?.sinceMs;
      if (sinceMs !== undefined) {
        filtered = filtered.filter((t) => t.blockTimestamp * 1000 >= sinceMs);
      }
      // Sort most-recent-first so limit returns the newest transfers
      filtered.sort((a, b) => a.blockTimestamp - b.blockTimestamp);
      if (opts?.limit !== undefined) {
        filtered = filtered.slice(-opts.limit);
      }
      return filtered;
    },

    async usdtBalance(address: string) {
      return usdtBalances.get(address) ?? "0.000000";
    },

    async trxBalanceSun(address: string) {
      return trxBalances.get(address) ?? 0n;
    },

    async sendUsdt({ fromAddress, toAddress, amount }) {
      sendUsdtCount++;
      const txHash = makeTxHash();

      const fromBal = usdtBalances.get(fromAddress) ?? "0.000000";
      usdtBalances.set(fromAddress, sub(fromBal, amount));

      const toBal = usdtBalances.get(toAddress) ?? "0.000000";
      usdtBalances.set(toAddress, add(toBal, amount));

      return { txHash };
    },

    async sendTrx({ fromAddress, toAddress, amountSun }) {
      sendTrxCount++;
      const txHash = makeTxHash();

      const fromBal = trxBalances.get(fromAddress) ?? 0n;
      trxBalances.set(fromAddress, fromBal - amountSun);

      const toBal = trxBalances.get(toAddress) ?? 0n;
      trxBalances.set(toAddress, toBal + amountSun);

      return { txHash };
    },
  };

  const controls: FakeTronControls = {
    __setUsdtBalance(address, amount) {
      usdtBalances.set(address, amount);
    },
    __setTrxBalance(address, sun) {
      trxBalances.set(address, sun);
    },
    __injectTransfer(toAddress, transfer) {
      const list = transferLog.get(toAddress) ?? [];
      list.push(transfer);
      transferLog.set(toAddress, list);
    },
    get __sendUsdtCount() { return sendUsdtCount; },
    get __sendTrxCount() { return sendTrxCount; },
  };

  return Object.assign(service, { controls });
}
