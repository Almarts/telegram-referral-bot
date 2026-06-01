import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes, bytesToHex, concatBytes } from "@noble/hashes/utils";
import { base58check } from "@scure/base";
import type { TronService, UsdtTransfer, Signer } from "./types";

// BIP44 path prefix for TRON (coin type 195 = 0x800000C3)
const TRON_PATH_PREFIX = "m/44'/195'/0'/0/";

// TRON mainnet address prefix byte (0x41 = 'A' in ASCII, produces 'T' base58)
const TRON_ADDRESS_PREFIX = new Uint8Array([0x41]);

// USDT TRC20 contract address on TRON mainnet
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// TronGrid API base URL
const TRONGRID_BASE = "https://api.trongrid.io";

// Cached base58check encoder
const base58 = base58check(sha256);

// ---------------------------------------------------------------------------
// Pure functions (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Derive a TRC20 address from an xprv at a given BIP32 index.
 * Path: m/44'/195'/0'/0/{index}
 */
export function deriveDepositAddress(xprv: string, index: number): string {
  const hdkey = HDKey.fromExtendedKey(xprv);
  const child = hdkey.derive(`${TRON_PATH_PREFIX}${index}`);
  if (!child.publicKey) {
    throw new Error("Failed to derive public key from xprv");
  }
  return tronAddressFromPublicKey(child.publicKey);
}

/**
 * Convert a secp256k1 public key (compressed 33-byte or uncompressed 65-byte)
 * to a TRON base58check address (34 chars, starts with 'T').
 *
 * TRON address algorithm:
 *   - If compressed, decompress to 65-byte (04 || x || y)
 *   - keccak256(bytes[1:])  — hash the 64-byte (x, y) without the 04 prefix
 *   - last 20 bytes of the hash
 *   - prefix with 0x41 (mainnet)
 *   - base58check encode with double-SHA256 checksum
 */
export function tronAddressFromPublicKey(pubkey: Uint8Array): string {
  // Get the uncompressed pubkey (65 bytes = 04 || x || y)
  const uncompressed =
    pubkey.length === 65
      ? pubkey
      : secp256k1.ProjectivePoint.fromHex(pubkey).toRawBytes(false);

  // keccak256 of the 64-byte (x, y) without the 0x04 prefix
  const hash = keccak_256(uncompressed.subarray(1));

  // Last 20 bytes of the hash → the TRON address payload
  const payload = hash.subarray(hash.length - 20);

  // Prefix with 0x41 (mainnet) → 21 bytes total
  const prefixed = new Uint8Array(21);
  prefixed.set(TRON_ADDRESS_PREFIX, 0);
  prefixed.set(payload, 1);

  // Base58Check encode with double SHA256
  return base58.encode(prefixed);
}

/**
 * Normalize a TRC20 atomic value (6-decimal integer string) to a 6dp USDT
 * string, e.g. "15000000" → "15.000000".
 */
function atomicToUsdt(atomicValue: string): string {
  const raw = BigInt(atomicValue);
  const intPart = raw / 1_000_000n;
  const fracPart = raw % 1_000_000n;
  return `${intPart}.${String(fracPart).padStart(6, "0")}`;
}

/**
 * Convert a USDT decimal string (e.g. "15.000000") to atomic TRC20 units
 * (e.g. 15000000n).
 */
export function usdtToAtomic(amount: string): bigint {
  const [intPart = "", fracPart = ""] = amount.split(".");
  const paddedFrac = fracPart.padEnd(6, "0").slice(0, 6);
  return BigInt(`${intPart}${paddedFrac}`);
}

/**
 * Parse USDT transfers from a TronGrid /v1/accounts/{addr}/transactions/trc20
 * response. Filters to only confirmed 'Transfer' events matching the target
 * address.
 */
export function parseUsdtTransfers(
  response: { data: unknown[] },
  targetTo: string,
): UsdtTransfer[] {
  // Guard before cast
  if (!Array.isArray(response.data)) return [];
  const data = response.data as Array<Record<string, unknown>>;

  return data
    .filter(
      (tx) =>
        String(tx.to) === targetTo &&
        String(tx.type) === "Transfer",
    )
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
// Internal helpers
// ---------------------------------------------------------------------------

/** Get TRON address from a hex private key string. */
function addressFromPrivateKey(pkHex: string): string {
  const clean = pkHex.startsWith("0x") ? pkHex.slice(2) : pkHex;
  const pkBytes = hexToBytes(clean);
  const pubKey = secp256k1.getPublicKey(pkBytes, false); // uncompressed
  return tronAddressFromPublicKey(pubKey);
}

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface RealTronOpts {
  /** TRON_DEPOSIT_XPRV — extended private key for HD derivation. */
  xprv: string;
  /** TRON_HOT_WALLET_PK — hex private key for the hot wallet. */
  hotPk: string;
  /** TRONGRID_API_KEY — TronGrid API key. */
  apiKey: string;
}

// ---------------------------------------------------------------------------
// TronService factory
// ---------------------------------------------------------------------------

/**
 * Create a real TronService backed by @scure/bip32 HD derivation and TronGrid
 * REST API. tronweb is used only for transaction building and signing.
 */
export function createRealTron(opts: RealTronOpts): TronService {
  if (!opts.xprv) throw new Error("RealTronOpts.xprv is required");
  if (!opts.hotPk) throw new Error("RealTronOpts.hotPk is required");
  if (!opts.apiKey) throw new Error("RealTronOpts.apiKey is required");

  const hdkey = HDKey.fromExtendedKey(opts.xprv);
  const hotAddress = addressFromPrivateKey(opts.hotPk);

  // -----------------------------------------------------------------------
  // Shared tronweb accessor
  // -----------------------------------------------------------------------

  async function _getTronWeb() {
    const { getTronWeb } = await import("./tronweb-client");
    return getTronWeb(opts.apiKey);
  }

  // -----------------------------------------------------------------------
  // Signer factory (moved inside to capture opts.apiKey via closure)
  // -----------------------------------------------------------------------

  function createSignerFromKey(
    privateKeyHex: string,
    address: string,
  ): Signer {
    return {
      address,
      async privateKeyHex() {
        return privateKeyHex;
      },
      async sign(rawTx: unknown): Promise<{ txId: string }> {
        const tw = await _getTronWeb();
        // tronWeb.trx.sign expects a raw transaction object
        const signed = await tw.trx.sign(
          rawTx as Parameters<typeof tw.trx.sign>[0],
          privateKeyHex,
        );
        // The signed tx has txID (uppercase) but the interface uses txId.
        // Cast through unknown since signed contains far more fields.
        return signed as unknown as { txId: string };
      },
    };
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(timer));
  }

  /** TronGrid GET with JSON response error handling and 10s timeout. */
  async function tronGet<T>(path: string): Promise<T> {
    const url = `${TRONGRID_BASE}${path}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          "TRON-PRO-API-KEY": opts.apiKey,
          Accept: "application/json",
        },
      },
      10_000,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TronGrid ${res.status} on GET ${path}: ${body}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      const body = await res.text().catch(() => "");
      throw new Error(`TronGrid returned non-JSON response: ${body.slice(0, 200)}`);
    }
  }

  /** Broadcast a signed transaction with 30s timeout. */
  async function broadcastAndWait(
    tx: unknown,
  ): Promise<{ txHash: string }> {
    const url = `${TRONGRID_BASE}/wallet/broadcasttransaction`;
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "TRON-PRO-API-KEY": opts.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(tx),
      },
      30_000,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Broadcast failed ${res.status}: ${body}`);
    }
    const result = (await res.json()) as {
      txid?: string;
      txID?: string;
      result?: boolean;
      code?: string;
      message?: string;
    };
    if (result.result === false) {
      throw new Error(
        `Broadcast rejected: code=${result.code ?? "?"} message=${result.message ?? "?"}`,
      );
    }
    const txHash = result.txid ?? result.txID;
    if (!txHash) {
      throw new Error(
        `Broadcast response missing txid: ${JSON.stringify(result)}`,
      );
    }
    return { txHash };
  }

  // -----------------------------------------------------------------------
  // USDT transfer via raw broadcasthex (avoids tronweb's broken broadcast)
  // -----------------------------------------------------------------------

  /**
   * Build, sign, and broadcast a USDT TRC20 transfer.
   * Uses TronWeb for building, then signs + broadcasts via wallet/broadcasthex
   * which delivers reliably to the P2P network.
   */
  async function rawUsdtTransfer(
    privateKeyHex: string,
    fromAddress: string,
    toAddress: string,
    amount: string,
  ): Promise<{ txHash: string }> {
    const tw = await _getTronWeb();
    const atomicAmount = usdtToAtomic(amount);

    // 1. Build the unsigned triggerSmartContract via tronweb builder
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built: any = await tw.transactionBuilder.triggerSmartContract(
      USDT_CONTRACT,
      "transfer(address,uint256)",
      { feeLimit: 100_000_000, callValue: 0 },
      [
        { type: "address", value: toAddress },
        { type: "uint256", value: atomicAmount.toString() },
      ],
      fromAddress,
    );

    const tx = built.transaction;

    // 2. Sign using tronweb (this hashes raw_data via protobuf, giving correct hash)
    const signed = await tw.trx.sign(built.transaction, privateKeyHex);

    // 3. Extract the hex signature from tronweb's signed result
    const sigHex: string =
      (signed.signature?.[0]) ?? "";

    if (!sigHex) {
      throw new Error("No signature in tronweb signed result");
    }

    // 4. Serialize the signed transaction with a custom replacer that converts
    //    BigInt and Buffer/Uint8Array to their string representations.
    const replacer = (key: string, value: unknown): unknown => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Uint8Array) return bytesToHex(value);
      if (typeof Buffer !== "undefined" && typeof Buffer === "function" && Buffer.isBuffer(value)) return bytesToHex(new Uint8Array(value));
      return value;
    };

    // Build minimal transaction: raw_data + signature
    const cleanTx = {
      raw_data: tx.raw_data,
      signature: [sigHex],
    };

    const broadcastBody = JSON.stringify(cleanTx, replacer);
    const broadcastUrl = `${TRONGRID_BASE}/wallet/broadcasthex`;
    const br = await fetchWithTimeout(
      broadcastUrl,
      {
        method: "POST",
        headers: {
          "TRON-PRO-API-KEY": opts.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: broadcastBody,
      },
      30_000,
    );

    if (!br.ok) {
      const errBody = await br.text().catch(() => "");
      throw new Error(`broadcasthex failed ${br.status}: ${errBody}`);
    }

    const result = (await br.json()) as {
      result?: boolean;
      code?: string;
      message?: string;
      txid?: string;
    };

    if (result.result === false) {
      throw new Error(
        `broadcasthex rejected: code=${result.code ?? "?"} message=${result.message ?? "?"}`,
      );
    }

    const txHash = result.txid ?? "";
    if (!txHash) {
      throw new Error(
        `broadcasthex response missing txid: ${JSON.stringify(result)}`,
      );
    }

    return { txHash };
  }

  // -----------------------------------------------------------------------
  // TronService implementation
  // -----------------------------------------------------------------------

  return {
    deriveDepositAddress(index: number) {
      return { address: deriveDepositAddress(opts.xprv, index) };
    },

    signerForIndex(index: number) {
      const child = hdkey.derive(`${TRON_PATH_PREFIX}${index}`);
      if (!child.publicKey || !child.privateKey) {
        throw new Error(`Failed to derive keys at index ${index}`);
      }
      const address = tronAddressFromPublicKey(child.publicKey);
      const pkHex = bytesToHex(child.privateKey);
      return createSignerFromKey(pkHex, address);
    },

    hotSigner() {
      return createSignerFromKey(opts.hotPk, hotAddress);
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
      if (opts_?.sinceMs !== undefined) {
        // TronGrid uses block_timestamp in ms; we can use min_block_timestamp
        params.set("min_block_timestamp", String(opts_.sinceMs));
      }

      const response = await tronGet<{ data: unknown[] }>(
        `/v1/accounts/${address}/transactions/trc20?${params}`,
      );
      return parseUsdtTransfers(response, address);
    },

    async usdtBalance(address: string): Promise<string> {
      const acct = await tronGet<{ data: Array<Record<string, unknown>> }>(
        `/v1/accounts/${address}`,
      );
      const trc20 = (acct.data?.[0]?.trc20 as Array<Record<string, string>> | undefined) ?? [];
      const usdtEntry = trc20.find(
        (t) => Object.keys(t)[0] === USDT_CONTRACT,
      );
      if (!usdtEntry) {
        // Account may be unactivated (no TRX). Fall back to checking TRC20
        // transfers to detect USDT held by an unactivated address.
        const transfers = await this.listUsdtTransfersTo(address, { limit: 1 });
        if (transfers.length > 0) {
          // Return the latest incoming transfer amount as the balance.
          // This is a best-effort approximation — the real balance can
          // only be obtained via triggerConstantContract.
          return transfers[0].amountUsdt;
        }
        return "0.000000";
      }
      return atomicToUsdt(usdtEntry[USDT_CONTRACT]);
    },

    async trxBalanceSun(address: string): Promise<bigint> {
      const acct = await tronGet<{ data: Array<Record<string, unknown>> }>(
        `/v1/accounts/${address}`,
      );
      const balance = (acct.data?.[0]?.balance as number | undefined) ?? 0;
      return BigInt(balance);
    },

    async sendUsdt({ fromAddress, toAddress, amount, signer }) {
      // Use raw broadcasthex — more reliable than tronweb's broadcast
      return rawUsdtTransfer(
        await signer.privateKeyHex(),
        fromAddress,
        toAddress,
        amount,
      );
    },

    async sendTrx({ fromAddress, toAddress, amountSun, signer }) {
      const tw = await _getTronWeb();

      // Guard against silent truncation via Number() cast
      const amount = Number(amountSun);
      if (!Number.isSafeInteger(amount)) {
        throw new Error(
          `sendTrx amountSun ${amountSun} exceeds safe integer range (2^53-1)`,
        );
      }

      const unsignedTx = await tw.transactionBuilder.sendTrx(
        toAddress,
        amount,
        fromAddress,
      );

      const signedTx = await signer.sign(unsignedTx);
      return broadcastAndWait(signedTx);
    },
  };
}
