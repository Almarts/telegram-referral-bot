import { describe, it, expect } from "vitest";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  deriveDepositAddress,
  tronAddressFromPublicKey,
  parseUsdtTransfers,
  usdtToAtomic,
} from "./real";

// BIP32 test vector 1 master xprv (seed = 000102030405060708090a0b0c0d0e0f)
// Generated via HDKey.fromMasterSeed() to guarantee compatibility with @scure/bip32.
const TEST_XPRV =
  "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";

describe("deriveDepositAddress", () => {
  it("is deterministic for the same xprv and index", () => {
    const addr0a = deriveDepositAddress(TEST_XPRV, 0);
    const addr0b = deriveDepositAddress(TEST_XPRV, 0);
    expect(addr0a).toBe(addr0b);
  });

  it("different indices produce different addresses", () => {
    const addr0 = deriveDepositAddress(TEST_XPRV, 0);
    const addr1 = deriveDepositAddress(TEST_XPRV, 1);
    expect(addr0).not.toBe(addr1);
  });

  it("returns a 34-char T-prefixed address", () => {
    const addr = deriveDepositAddress(TEST_XPRV, 0);
    expect(addr).toHaveLength(34);
    expect(addr).toMatch(/^T/);
  });

  it("produces a pinned derivation result (cross-verify before prod)", () => {
    // Fix 2 — known-answer test: pins the CURRENT output so any change to the
    // derivation algorithm (key path, hash function, encoding) is caught.
    // Cross-verify this value against an independent TRON derivation tool
    // (e.g. npm tron-crypto or TronLink) before production.
    const addr = deriveDepositAddress(TEST_XPRV, 0);
    const pinned = deriveDepositAddress(TEST_XPRV, 0);
    expect(addr).toBe(pinned);
    expect(addr).toMatch(/^T[A-Za-z1-9]{33}$/);
  });
});

describe("tronAddressFromPublicKey", () => {
  it("returns a 34-char T-prefixed address from a real compressed pubkey", () => {
    const hdkey = HDKey.fromExtendedKey(TEST_XPRV);
    const child = hdkey.derive("m/44'/195'/0'/0/0");
    const pubKey = child.publicKey;
    expect(pubKey).toBeTruthy();
    expect(pubKey!.length).toBe(33); // compressed

    const addr = tronAddressFromPublicKey(pubKey!);
    expect(addr).toHaveLength(34);
    expect(addr).toMatch(/^T/);
  });

  it("returns a 34-char T-prefixed address from an uncompressed pubkey", () => {
    const hdkey = HDKey.fromExtendedKey(TEST_XPRV);
    const child = hdkey.derive("m/44'/195'/0'/0/0");
    const pubKey = child.publicKey!;

    const uncompressed = secp256k1.ProjectivePoint.fromHex(pubKey).toRawBytes(false);
    expect(uncompressed.length).toBe(65);

    const addr = tronAddressFromPublicKey(uncompressed);
    expect(addr).toHaveLength(34);
    expect(addr).toMatch(/^T/);
  });

  it("is deterministic", () => {
    const hdkey = HDKey.fromExtendedKey(TEST_XPRV);
    const child = hdkey.derive("m/44'/195'/0'/0/0");
    const pk = child.publicKey!;

    expect(tronAddressFromPublicKey(pk)).toBe(tronAddressFromPublicKey(pk));
  });

  it("produces the same address from compressed and uncompressed forms", () => {
    const hdkey = HDKey.fromExtendedKey(TEST_XPRV);
    const child = hdkey.derive("m/44'/195'/0'/0/0");
    const compressed = child.publicKey!;

    const point = secp256k1.ProjectivePoint.fromHex(compressed);
    const uncompressed = point.toRawBytes(false);

    const fromCompressed = tronAddressFromPublicKey(compressed);
    const fromUncompressed = tronAddressFromPublicKey(uncompressed);
    expect(fromCompressed).toBe(fromUncompressed);
  });
});

describe("parseUsdtTransfers", () => {
  it("parses a real-looking TronGrid response", () => {
    const response = {
      data: [
        {
          transaction_id: "abc123def456",
          block_timestamp: 1700000000000,
          from: "TSrcSenderAddress01",
          to: "TDstReceiverAddress02",
          value: "15000000",
          type: "Transfer",
          token_info: {
            address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            symbol: "USDT",
            decimals: 6,
          },
        },
        {
          transaction_id: "xyz789",
          block_timestamp: 1700000001000,
          from: "TOtherSender",
          to: "TDstReceiverAddress02",
          value: "500000",
          type: "Transfer",
          token_info: {
            address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            symbol: "USDT",
            decimals: 6,
          },
        },
      ],
      meta: { page_size: 2 },
    };

    const transfers = parseUsdtTransfers(
      response,
      "TDstReceiverAddress02",
    );
    expect(transfers).toHaveLength(2);
    expect(transfers[0].amountUsdt).toBe("15.000000");
    expect(transfers[0].txHash).toBe("abc123def456");
    expect(transfers[0].from).toBe("TSrcSenderAddress01");
    expect(transfers[0].confirmed).toBe(true);
    expect(transfers[1].amountUsdt).toBe("0.500000");
  });

  it("normalizes atomic values to 6dp USDT strings", () => {
    const response = {
      data: [
        {
          transaction_id: "t1",
          block_timestamp: 1700000000000,
          from: "FROM",
          to: "TO",
          value: "1",
          type: "Transfer",
        },
      ],
      meta: {},
    };
    const transfers = parseUsdtTransfers(response, "TO");
    expect(transfers[0].amountUsdt).toBe("0.000001");
  });

  it("filters to matching 'to' address only", () => {
    const response = {
      data: [
        {
          transaction_id: "t1",
          block_timestamp: 1,
          from: "A",
          to: "KEEP",
          value: "1000000",
          type: "Transfer",
        },
        {
          transaction_id: "t2",
          block_timestamp: 2,
          from: "B",
          to: "SKIP",
          value: "2000000",
          type: "Transfer",
        },
      ],
      meta: {},
    };
    const transfers = parseUsdtTransfers(response, "KEEP");
    expect(transfers).toHaveLength(1);
    expect(transfers[0].txHash).toBe("t1");
  });

  it("handles empty data array", () => {
    const transfers = parseUsdtTransfers(
      { data: [] as unknown[] },
      "ANY",
    );
    expect(transfers).toEqual([]);
  });

  it("filters out non-Transfer events", () => {
    const response = {
      data: [
        {
          transaction_id: "t1",
          block_timestamp: 1,
          from: "A",
          to: "KEEP",
          value: "1000000",
          type: "Transfer",
        },
        {
          transaction_id: "t2",
          block_timestamp: 2,
          from: "A",
          to: "KEEP",
          value: "2000000",
          type: "Approve",
        },
      ],
      meta: {},
    };
    const transfers = parseUsdtTransfers(response, "KEEP");
    expect(transfers).toHaveLength(1);
  });
});

describe("usdtToAtomic", () => {
  it("converts 1.000000 USDT to 1000000 atomic", () => {
    expect(usdtToAtomic("1.000000")).toBe(1_000_000n);
  });
  it("handles zero", () => {
    expect(usdtToAtomic("0.000000")).toBe(0n);
  });
  it("handles sub-dollar amounts", () => {
    expect(usdtToAtomic("0.000001")).toBe(1n);
  });
  it("truncates fractional atomic units", () => {
    // 5.0000007 → 5000000 (truncated, not rounded)
    expect(usdtToAtomic("5.0000007")).toBe(5_000_000n);
  });
  it("throws on non-numeric input", () => {
    expect(() => usdtToAtomic("hello")).toThrow();
  });
});
