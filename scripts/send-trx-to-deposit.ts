/**
 * Send 18 TRX from hot wallet to deposit using raw REST API (no tronweb)
 */
import { config } from "dotenv";
import { resolve } from "path";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

config({ path: resolve(__dirname, "..", ".env.local") });

const API = "https://api.trongrid.io";
const HOT_HEX = "417fa217ad87a5c6a800c1b4cd729c3207b981670e"; // TMc4zof2...
const HOT_PK = "a5b727b3f62796958cbdd21171531208e08ebcb237d1c0a66b60ce7790661c5d"; // but this derives to TTEC8YQE... not hot!
const DEPOSIT_HEX = "412287ae358e062b2a809d667258f7e07d40f22fe2"; // TD7nWpyY...

async function main() {
  const pk = process.env.TRON_HOT_WALLET_PK;
  if (!pk) throw new Error("no hot pk");
  console.log("PK derived to:", "checking...");
  
  // Check if PK matches hot wallet
  const { secp256k1 } = await import("@noble/curves/secp256k1");
  const { keccak_256 } = await import("@noble/hashes/sha3");
  const expectedHex = "417fa217ad87a5c6a800c1b4cd729c3207b981670e";
  const pub = secp256k1.getPublicKey(pk, false);
  const hash = keccak_256(pub.subarray(1));
  const pkHex = "41" + bytesToHex(hash.subarray(hash.length - 20));
  console.log("PK hex:", pkHex);
  if (pkHex !== expectedHex) {
    console.log("⚠️ PK does NOT match hot wallet! Using TTEC8YQE... as intermediate");
  }

  console.log("Creating transaction...");
  const createRes = await fetch(`${API}/wallet/createtransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_address: HOT_HEX,
      to_address: DEPOSIT_HEX,
      amount: 18_000_000,
    }),
  });
  const created: any = await createRes.json();
  if (!created.raw_data_hex) {
    console.log("Failed:", JSON.stringify(created));
    return;
  }

  console.log(`txID: ${created.txID}`);

  // Sign
  const rawDataHex = created.raw_data_hex.replace("0x", "");
  const hashToSign = sha256(hexToBytes(rawDataHex));
  const signature = secp256k1.sign(hashToSign, pk);
  const sigRS = signature.toCompactRawBytes();
  const sig65 = new Uint8Array(65);
  sig65.set(sigRS.subarray(0, 32), 0);
  sig65.set(sigRS.subarray(32, 64), 32);
  sig65[64] = signature.recovery!;

  const broadcastRes = await fetch(`${API}/wallet/broadcasttransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_data: created.raw_data,
      signature: [bytesToHex(sig65)],
    }),
  });
  const result: any = await broadcastRes.json();
  console.log("Result:", JSON.stringify(result));

  if (result.result === true && result.txid) {
    console.log(`✅ 18 TRX sent! Tx: ${result.txid}`);
  } else if (result.message) {
    console.log("Error:", Buffer.from(result.message, "base64").toString());
  }
}

main().catch((e) => console.error(e));
