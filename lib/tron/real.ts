import type { TronService, UsdtTransfer } from "./types";

// USDT TRC20 contract address on TRON mainnet
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// TronGrid API base URL
const TRONGRID_BASE = "https://api.trongrid.io";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function atomicToUsdt(atomicValue: string): string {
  const raw = BigInt(atomicValue);
  const intPart = raw / 1_000_000n;
  const fracPart = raw % 1_000_000n;
  return `${intPart}.${String(fracPart).padStart(6, "0")}`;
}

export function parseUsdtTransfers(
  response: { data: unknown[] },
  targetTo: string,
): UsdtTransfer[] {
  if (!Array.isArray(response.data)) return [];
  const data = response.data as Array<Record<string, unknown>>;

  return data
    .filter((tx) => String(tx.to) === targetTo && String(tx.type) === "Transfer")
    .map((tx) => ({
      txHash: String(tx.transaction_id),
      from: String(tx.from),
      to: String(tx.to),
      amountUsdt: atomicToUsdt(String(tx.value)),
      blockTimestamp: Math.floor(Number(tx.block_timestamp) / 1000),
      confirmed: true,
    }));
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RealTronOpts {
  apiKey: string;
}

// ---------------------------------------------------------------------------
// TronService factory — read-only, no private keys needed
// ---------------------------------------------------------------------------

export function createRealTron(opts: RealTronOpts): TronService {
  if (!opts.apiKey) throw new Error("RealTronOpts.apiKey is required");

  async function _getTronWeb() {
    const { getTronWeb } = await import("./tronweb-client");
    return getTronWeb(opts.apiKey);
  }

  function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer));
  }

  async function tronGet<T>(path: string): Promise<T> {
    const url = `${TRONGRID_BASE}${path}`;
    const res = await fetchWithTimeout(url, {
      headers: { "TRON-PRO-API-KEY": opts.apiKey, Accept: "application/json" },
    }, 10_000);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TronGrid ${res.status} on GET ${path}: ${body}`);
    }
    try { return (await res.json()) as T; }
    catch {
      const body = await res.text().catch(() => "");
      throw new Error(`TronGrid returned non-JSON: ${body.slice(0, 200)}`);
    }
  }

  async function tronPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${TRONGRID_BASE}${path}`;
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "TRON-PRO-API-KEY": opts.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }, 10_000);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`TronGrid POST ${res.status} on ${path}: ${bodyText}`);
    }
    return (await res.json()) as T;
  }

  return {
    deriveDepositAddress() { throw new Error("No deposit addresses — payments go to cold wallet"); },
    signerForIndex() { throw new Error("No signing — read-only TronService"); },
    hotSigner() { throw new Error("No signing — read-only TronService"); },

    async verifyUsdtTransfer(txHash: string, expectedTo: string): Promise<{
      confirmed: boolean;
      from: string;
      to: string;
      amountUsdt: string;
    } | null> {
      try {
        // Fetch specific tx from TronGrid trc20 endpoint
        const res = await tronGet<{ data?: Array<Record<string, unknown>>; meta?: Record<string, unknown> }>(
          `/v1/transactions/${txHash}?only_confirmed=true&limit=1`,
        );
        if (!res.data?.length) {
          // The tx exists but not confirmed yet, or not found
          return null;
        }

        // Try /v1/transactions/ first — returns raw tx data
        // For TRC20, we need the /v1/transactions/{hash} endpoint or /v1/transactions/trc20
        const trc20Res = await tronGet<{ data?: Array<Record<string, unknown>> }>(
          `/v1/transactions/trc20?transaction_id=${txHash}&only_confirmed=true&limit=1`,
        );
        if (!trc20Res.data?.length) return null;

        const tx = trc20Res.data[0] as Record<string, unknown>;
        const to = String(tx.to ?? "");
        if (to !== expectedTo) return null; // not sent to cold wallet

        return {
          confirmed: true,
          from: String(tx.from ?? ""),
          to,
          amountUsdt: atomicToUsdt(String(tx.value ?? "0")),
        };
      } catch {
        return null;
      }
    },

    async listUsdtTransfersTo(
      address: string,
      opts_?: { sinceMs?: number; limit?: number },
    ): Promise<UsdtTransfer[]> {
      const params = new URLSearchParams({
        contract_address: USDT_CONTRACT,
        only_confirmed: "true",
        limit: String(opts_?.limit ?? 200),
      });
      if (opts_?.sinceMs !== undefined) params.set("min_block_timestamp", String(opts_.sinceMs));

      const response = await tronGet<{ data: unknown[] }>(
        `/v1/accounts/${address}/transactions/trc20?${params}`,
      );
      return parseUsdtTransfers(response, address);
    },

    async usdtBalance(address: string): Promise<string> {
      const tw = await _getTronWeb();
      try {
        const req = await tw.transactionBuilder.triggerConstantContract(
          USDT_CONTRACT, "balanceOf(address)", {},
          [{ type: "address", value: address }], address,
        );
        if (req.result?.result && req.constant_result?.[0]) {
          const hex = req.constant_result[0];
          return atomicToUsdt(BigInt("0x" + hex).toString());
        }
      } catch { /* fallthrough */ }
      try {
        const acct = await tronPost<{ balance?: number; trc20?: Array<Record<string, string>> }>(
          "/wallet/getaccount", { address: address },
        );
        const trc20 = (acct.trc20 ?? []) as Array<Record<string, string>>;
        const entry = trc20.find(t => Object.keys(t)[0] === USDT_CONTRACT);
        if (entry) return atomicToUsdt(entry[USDT_CONTRACT]);
      } catch { /* fallthrough */ }
      return "0.000000";
    },

    async trxBalanceSun(address: string): Promise<bigint> {
      const acct = await tronPost<{ balance?: number }>(
        "/wallet/getaccount", { address: address },
      );
      return BigInt((acct.balance as number | undefined) ?? 0);
    },

    async sendUsdt() { throw new Error("sendUsdt removed — all payments go directly to cold wallet"); },
    async sendTrx() { throw new Error("sendTrx removed"); },
  };
}
