import type { TronService, UsdtTransfer } from "./types";

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
    async verifyTrxTransfer(txHash: string, expectedTo: string, minTrxSun: bigint) {
      return null;
    },

    async verifyUsdtTransfer(txHash: string, expectedTo: string) {
      return null;
    },

    async listUsdtTransfersTo(address: string, opts?: { sinceMs?: number; limit?: number }) {
      const all = transferLog.get(address) ?? [];
      let filtered = all.filter((t) => t.confirmed);
      const sinceMs = opts?.sinceMs;
      if (sinceMs !== undefined) {
        filtered = filtered.filter((t) => t.blockTimestamp * 1000 >= sinceMs);
      }
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
