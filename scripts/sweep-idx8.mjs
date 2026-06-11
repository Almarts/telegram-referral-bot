/**
 * Sweep 1 USDT from deposit idx=8 (TN8sYb6UPtJrECPekQqZmyrooZ4QPWHNTu)
 * to cold wallet TXKx4zMsfDt11Mfgb2wZSuQDpobuqJj3nC
 *
 * Steps:
 *   1. wallet/triggersmartcontract builds the transaction
 *   2. Sign raw_data_hex (SHA256 of protobuf bytes) with ECDSA
 *   3. Broadcast via wallet/broadcasttransaction
 */
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { base58check } from "@scure/base";
import { readFileSync } from "fs";

// ── Parse .env.local ────────────────────────────────────────────────────────
const envRaw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = {};
for (const line of envRaw.split("\n")) {
  const idx = line.indexOf("=");
  if (idx > 0) env[line.slice(0, idx)] = line.slice(idx + 1).trim();
}

const XPRV = env.TRON_DEPOSIT_XPRV;
const COLD_ADDR = env.TRON_COLD_WALLET_ADDRESS;
const API_KEY = env.TRONGRID_API_KEY;
const API = "https://api.trongrid.io";

// ── Addresses ───────────────────────────────────────────────────────────────
const DEPOSIT_ADDR = "TN8sYb6UPtJrECPekQqZmyrooZ4QPWHNTu"; // idx=8
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// Base58 → Hex helpers
const base58 = base58check(sha256);
function toHex(b58) {
  const decoded = base58.decode(b58);
  // decoded is 25 bytes: [version_byte, 20_bytes_payload, 4_bytes_checksum]
  // TRON expects: 41 (version) || 20 bytes payload = 21 bytes
  return "41" + bytesToHex(decoded.subarray(1, 21));
}

const OWNER_HEX = toHex(DEPOSIT_ADDR);
const CONTRACT_HEX = toHex(USDT_CONTRACT);
const COLD_HEX = toHex(COLD_ADDR);
// Parameter format: address(160bit, 20bytes) padded to 32 bytes + uint256(32 bytes)
const COLD_HEX_NO_PREFIX = COLD_HEX.slice(2); // strip 0x41
const PARAM =
  "000000000000000000000000" + COLD_HEX_NO_PREFIX +
  "00000000000000000000000000000000000000000000000000000000000f4240"; // 1 USDT = 1_000_000

async function main() {
  console.log("=== SWEEP idx=8 → Cold Wallet ===");
  console.log(`Deposit:  ${DEPOSIT_ADDR}`);
  console.log(`Cold:     ${COLD_ADDR}`);
  console.log(`OwnerHex: ${OWNER_HEX}`);
  console.log(`ColdHex:  ${COLD_HEX}`);
  console.log("");

  // Derive private key for idx=8
  console.log("Deriving private key for idx=8...");
  const hdkey = HDKey.fromExtendedKey(XPRV);
  const child = hdkey.derive("m/44'/195'/0'/0/8");
  if (!child.privateKey) throw new Error("Failed to derive private key");
  const pkHex = bytesToHex(child.privateKey);
  console.log(`PK: ${pkHex.slice(0, 8)}...${pkHex.slice(-4)}`);

  // Step 1: Build transaction
  console.log("\nBuilding transaction via triggerSmartContract...");
  const body = {
    owner_address: OWNER_HEX,
    contract_address: CONTRACT_HEX,
    function_selector: "transfer(address,uint256)",
    parameter: PARAM,
    fee_limit: 18_000_000,
    call_value: 0,
  };
  console.log("Request:", JSON.stringify(body, null, 2));

  const triggerRes = await fetch(`${API}/wallet/triggersmartcontract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "TRON-PRO-API-KEY": API_KEY,
    },
    body: JSON.stringify(body),
  });
  const triggerResult = await triggerRes.json();

  if (!triggerResult.result?.result || !triggerResult.transaction) {
    console.log("❌ Build failed:", JSON.stringify(triggerResult, null, 2));
    if (triggerResult.Error) {
      console.log("Error msg:", triggerResult.Error);
    }
    if (triggerResult.result?.message) {
      const msg = Buffer.from(triggerResult.result.message, "base64").toString();
      console.log("Decoded message:", msg);
    }
    process.exit(1);
  }

  const tx = triggerResult.transaction;
  const rawDataHex = (tx.raw_data_hex || "").replace("0x", "");
  console.log(`txID: ${tx.txID}`);
  console.log(`raw_data_hex (${(rawDataHex.length / 2)} bytes)`);

  // Step 2: Sign
  console.log("\nSigning...");
  const rawDataBytes = hexToBytes(rawDataHex);
  const hashToSign = sha256(rawDataBytes);
  console.log(`SHA256 hash: ${bytesToHex(hashToSign)}`);

  const signature = secp256k1.sign(hashToSign, pkHex);
  const sigRS = signature.toCompactRawBytes(); // 64 bytes r||s
  const sig65 = new Uint8Array(65);
  sig65.set(sigRS.subarray(0, 32), 0);
  sig65.set(sigRS.subarray(32, 64), 32);
  sig65[64] = signature.recovery;
  const sigHex = bytesToHex(sig65);
  console.log(`Signature: ${sigHex.slice(0, 16)}...${sigHex.slice(-8)}`);

  // Step 3: Broadcast
  console.log("\nBroadcasting...");
  const broadcastBody = {
    raw_data: tx.raw_data,
    signature: [sigHex],
  };

  const broadcastRes = await fetch(`${API}/wallet/broadcasttransaction`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "TRON-PRO-API-KEY": API_KEY,
    },
    body: JSON.stringify(broadcastBody),
  });

  const broadcastResult = await broadcastRes.json();
  console.log("Broadcast result:", JSON.stringify(broadcastResult, null, 2));

  if (broadcastResult.result === true && broadcastResult.txid) {
    console.log(`\n✅ SUCCESS! Swept 1 USDT!`);
    console.log(`TxID: ${broadcastResult.txid}`);
    console.log(`🔗 https://tronscan.org/#/transaction/${broadcastResult.txid}`);
  } else if (broadcastResult.message) {
    const msg = Buffer.from(broadcastResult.message, "base64").toString();
    console.log(`❌ Broadcast error: ${msg}`);
  } else if (broadcastResult.Error) {
    console.log(`❌ Error: ${broadcastResult.Error}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
