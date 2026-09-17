import type { TronService } from "./types";
import type { UsdtTransfer, VerifyUsdtResult } from "./types";

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

/**
 * Decode a TRC20 `transfer(address,uint256)` payload.
 *
 * Calldata layout: selector (4 bytes) | to (32 bytes, left-padded) | amount (32 bytes).
 *
 * Returns null when the calldata is not a plain TRC20 transfer, so callers can
 * treat "not a transfer" and "transfer to the wrong party" the same way.
 */
export function decodeTrc20Transfer(data: string): { toHex: string; rawAmount: bigint } | null {
  const hex = String(data ?? "");
  if (!hex.startsWith("a9059cbb")) return null;
  // 8 hex chars = 4-byte selector; address occupies the last 20 bytes of the next slot
  const toHex = "41" + hex.slice(32, 72);
  if (toHex.length !== 42) return null;
  try {
    return { toHex, rawAmount: BigInt("0x" + hex.slice(72, 136)) };
  } catch {
    return null;
  }
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
    async verifyTrxTransfer(txHash: string, expectedTo: string, minTrxSun: bigint): Promise<{
      confirmed: boolean;
      from: string;
      to: string;
      amountSun: bigint;
    } | null> {
      try {
        // Get transaction info from TronGrid
        // NOTE: /v1/transactions/{txHash} returns 404 for many confirmed TXes.
        // Using /wallet/gettransactionbyid instead (works reliably).
        const tx = await tronPost<Record<string, unknown>>("/wallet/gettransactionbyid", {
          value: txHash,
        });
        if (!tx || !tx.txID) return null;
        // Check it's confirmed (has blockNumber)
        const txInfo = await tronPost<Record<string, unknown>>("/wallet/gettransactioninfobyid", {
          value: txHash,
        });
        if (!txInfo || !txInfo.blockNumber) return null;

        const rawData = tx.raw_data as Record<string, unknown> | undefined;
        const contracts = rawData?.contract as Array<Record<string, unknown>> | undefined;

        if (!contracts?.length) return null;

        const contract = contracts[0] as Record<string, unknown>;
        const param = contract.parameter as Record<string, unknown> | undefined;
        const value = param?.value as Record<string, unknown> | undefined;

        if (!value) return null;

        const toAddress = String(value.to_address ?? "");
        const amount = BigInt(String(value.amount ?? "0"));

        // Decode base58 address
        if (!toAddress) return null;

        // Check recipient matches expected
        if (toAddress !== expectedTo && toAddress !== expectedTo) {
          // Try base58 decoding both
          const { getTronWeb } = await import("./tronweb-client");
          const tw = getTronWeb(opts.apiKey);
          try {
            const decodedTo = tw.address.fromHex(String(value.to_address ?? ""));
            if (decodedTo !== expectedTo) return null;
          } catch { return null; }
        }

        // Check amount
        if (amount < minTrxSun) return null;

        const fromHex = String(tx.owner_address ?? tx.ownerAddress ?? "");
        let from = fromHex;
        try {
          const { getTronWeb } = await import("./tronweb-client");
          const tw = getTronWeb(opts.apiKey);
          from = tw.address.fromHex(fromHex);
        } catch { /* use hex */ }

        return {
          confirmed: true,
          from,
          to: expectedTo,
          amountSun: amount,
          blockTimestamp: Math.floor(Number(txInfo.blockNumber) * 3),
        };
      } catch {
        return null;
      }
    },

    async verifyUsdtTransfer(txHash: string, expectedTo: string): Promise<VerifyUsdtResult> {
      try {
        // NOTE: the /v1/transactions/* REST endpoints return 404 with our API key
        // (and rate-limit hard without one). The /wallet/* node endpoints work
        // reliably, so decode the TRC20 transfer out of the raw contract data.
        const tx = await tronPost<Record<string, unknown>>("/wallet/gettransactionbyid", {
          value: txHash,
        });
        if (!tx || !tx.txID) {
          return { ok: false, reason: "not_found", detail: "no transaction with this hash" };
        }

        // Must be confirmed (mined into a block)
        const txInfo = await tronPost<Record<string, unknown>>("/wallet/gettransactioninfobyid", {
          value: txHash,
        });
        if (!txInfo || !txInfo.blockNumber) {
          return { ok: false, reason: "not_confirmed", detail: "transaction is not yet mined" };
        }
        const receipt = txInfo.receipt as Record<string, unknown> | undefined;
        if (receipt && receipt.result && String(receipt.result) !== "SUCCESS") {
          return { ok: false, reason: "not_found", detail: `receipt=${String(receipt.result)}` };
        }

        const rawData = tx.raw_data as Record<string, unknown> | undefined;
        const contracts = rawData?.contract as Array<Record<string, unknown>> | undefined;
        if (!contracts?.length) {
          return { ok: false, reason: "not_usdt", detail: "transaction has no contract call" };
        }

        const contract = contracts[0] as Record<string, unknown>;
        const param = contract.parameter as Record<string, unknown> | undefined;
        const value = param?.value as Record<string, unknown> | undefined;
        if (!value) {
          return { ok: false, reason: "not_usdt", detail: "contract call has no parameters" };
        }

        // Must be a call to the USDT TRC20 contract
        const contractAddrHex = String(value.contract_address ?? "");
        const { getTronWeb } = await import("./tronweb-client");
        const tw = getTronWeb(opts.apiKey);
        let contractAddr = contractAddrHex;
        try { contractAddr = tw.address.fromHex(contractAddrHex); } catch { /* keep hex */ }
        if (contractAddr !== USDT_CONTRACT) {
          return { ok: false, reason: "not_usdt", detail: `contract is ${contractAddr}, not USDT` };
        }

        // TRC20 transfer(address,uint256) — decode the calldata
        const decoded = decodeTrc20Transfer(String(value.data ?? ""));
        if (!decoded) {
          return { ok: false, reason: "not_usdt", detail: "not a TRC20 transfer() call" };
        }

        let to = decoded.toHex;
        try { to = tw.address.fromHex(decoded.toHex); } catch { /* keep hex */ }
        if (to !== expectedTo) return { ok: false, reason: "wrong_address", detail: `sent to ${to}` };

        // Sender address
        let from = String(value.owner_address ?? "");
        try { from = tw.address.fromHex(from); } catch { /* keep hex */ }

        return {
          ok: true,
          from,
          to,
          amountUsdt: atomicToUsdt(decoded.rawAmount.toString()),
        };
      } catch (err) {
        // Network/HTTP failure — surface it instead of pretending the tx is absent
        return { ok: false, reason: "rpc_error", detail: String(err) };
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
  };
}
