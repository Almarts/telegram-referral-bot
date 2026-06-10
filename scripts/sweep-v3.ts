/**
 * Sign and broadcast USDT transfer from deposit to cold wallet.
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
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "..", ".env.local") });

const XPRV = process.env.TRON_DEPOSIT_XPRV || "";
const API = "https://api.trongrid.io";

// Hardcoded hex addresses (derived from base58 earlier)
const OWNER_HEX = "412287ae358e062b2a809d667258f7e07d40f22fe2"; // TD7nWpyY...
const CONTRACT_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c"; // USDT
const COLD_HEX_NO_PREFIX = "119c738b0572b184083711b6b7473cf25e5b7a35"; // TBaKukS...

async function main() {
  console.log("Deriving private key...");
  const hdkey = HDKey.fromExtendedKey(XPRV);
  const child = hdkey.derive("m/44'/195'/0'/0/7");
  if (!child.privateKey) throw new Error("Failed to derive private key");

  const pkHex = bytesToHex(child.privateKey);
  console.log(`PK: ${pkHex.substring(0, 8)}...${pkHex.substring(pkHex.length - 4)}`);

  // Build trigger parameter: transfer(address,uint256)
  const parameter =
    "000000000000000000000000" + COLD_HEX_NO_PREFIX +
    "00000000000000000000000000000000000000000000000000000000000f4240";

  // Step 1: Build transaction
  console.log("Building transaction via triggerSmartContract...");
  const triggerRes = await fetch(`${API}/wallet/triggersmartcontract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_address: OWNER_HEX,
      contract_address: CONTRACT_HEX,
      function_selector: "transfer(address,uint256)",
      parameter,
      fee_limit: 18_000_000,
      call_value: 0,
    }),
  });
  const triggerResult: any = await triggerRes.json();

  if (!triggerResult.result?.result || !triggerResult.transaction) {
    console.log("❌ Build failed:", JSON.stringify(triggerResult, null, 2));
    return;
  }

  const tx = triggerResult.transaction;
  const rawDataHex = (tx.raw_data_hex || "").replace("0x", "");
  console.log(`txID: ${tx.txID}`);
  console.log(`raw_data_hex (${rawDataHex.length / 2} bytes)`);

  // Step 2: Sign
  // TRON signs the SHA256 (not keccak256!) of the protobuf-serialized raw_data
  // TRON signs SHA256(raw_data_bytes)
  const rawDataBytes = hexToBytes(rawDataHex);
  const hashToSign = sha256(rawDataBytes);
  
  console.log(`Hash to sign (SHA256): ${bytesToHex(hashToSign)}`);

  // ECDSA sign
  const signature = secp256k1.sign(hashToSign, pkHex);
  const sigRS = signature.toCompactRawBytes(); // 64 bytes

  // Tron format: 65 bytes r(32) || s(32) || v(1)
  const sig65 = new Uint8Array(65);
  sig65.set(sigRS.subarray(0, 32), 0);
  sig65.set(sigRS.subarray(32, 64), 32);
  sig65[64] = signature.recovery!;
  const sigHex = bytesToHex(sig65);

  // Step 3: Broadcast using the structure from trigger response
  const broadcastBody = {
    raw_data: tx.raw_data,
    signature: [sigHex],
  };

  console.log("Broadcasting...");
  const broadcastRes = await fetch(`${API}/wallet/broadcasttransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(broadcastBody),
  });
  const broadcastResult: any = await broadcastRes.json();
  console.log("Result:", JSON.stringify(broadcastResult, null, 2));

  if (broadcastResult.result === true && broadcastResult.txid) {
    console.log(`\n✅ SUCCESS! Tx: ${broadcastResult.txid}`);
    console.log(`🔗 https://tronscan.org/#/transaction/${broadcastResult.txid}`);
  } else if (broadcastResult.message) {
    const msg = Buffer.from(broadcastResult.message, "base64").toString();
    console.log(`❌ Error: ${msg}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
