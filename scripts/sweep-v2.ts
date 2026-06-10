/**
 * TRX sweep from deposit to cold — direct REST API signing
 * No tronweb, no ethers. Pure @scure/bip32 + @noble + fetch.
 */
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { base58 } from "@scure/base";
import { config } from "dotenv";
import { resolve } from "path";
import { createHash } from "crypto";

config({ path: resolve(__dirname, "..", ".env.local") });

const XPRV = process.env.TRON_DEPOSIT_XPRV || "";

function sha256(buf: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(buf).digest());
}

function doubleSha256(buf: Uint8Array): Uint8Array {
  return sha256(sha256(buf));
}

function base58CheckDecode(str: string): Uint8Array {
  const decoded = base58.base58.decode(str);
  if (decoded.length < 4) throw new Error("too short");
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const hash = doubleSha256(payload);
  for (let i = 0; i < 4; i++) {
    if (hash[i] !== checksum[i]) throw new Error("bad checksum");
  }
  return payload;
}

function base58CheckEncode(versioned: Uint8Array): string {
  const checksum = doubleSha256(versioned).slice(0, 4);
  const combined = new Uint8Array(versioned.length + 4);
  combined.set(versioned);
  combined.set(checksum, versioned.length);
  return base58.base58.encode(combined);
}

function addressFromPubkey(pubkey: Uint8Array): string {
  const uncompressed =
    pubkey.length === 65
      ? pubkey
      : secp256k1.ProjectivePoint.fromHex(pubkey).toRawBytes(false);
  const hash = keccak_256(uncompressed.subarray(1));
  const payload = hash.subarray(hash.length - 20);
  const prefixed = new Uint8Array(21);
  prefixed.set([0x41], 0);
  prefixed.set(payload, 1);
  return base58CheckEncode(prefixed);
}

async function main() {
  const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const COLD_WALLET = "TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW";
  const API = "https://api.trongrid.io";
  const DEPOSIT_INDEX = 7;

  console.log("Deriving keys...");
  const hdkey = HDKey.fromExtendedKey(XPRV);
  const child = hdkey.derive(`m/44'/195'/0'/0/${DEPOSIT_INDEX}`);
  if (!child.publicKey || !child.privateKey)
    throw new Error("Failed to derive keys");

  const depositAddress = addressFromPubkey(child.publicKey);
  const pkHex = bytesToHex(child.privateKey);
  console.log(`Deposit: ${depositAddress}`);

  // Get current block for ref
  console.log("Fetching current block...");
  const blockRes = await fetch(`${API}/wallet/getnowblock`);
  const block: any = await blockRes.json();
  const blockNum = block.block_header?.raw_data?.number || 0;
  const blockHash = block.blockID?.slice(0, 16) || "0000000000000000";

  // Build ref bytes (8 bytes: block number in big-endian, last 8 bytes of blockID)
  const refBlockBytes = hexToBytes(blockHash.slice(0, 16));
  console.log(`Block: ${blockNum}, ref: ${blockHash.slice(0, 16)}`);

  // Get timestamp
  const timestamp = block.block_header?.raw_data?.timestamp || Date.now();

  // Build addresses
  const ownerPayload = base58CheckDecode(depositAddress);
  const ownerHex = bytesToHex(ownerPayload);

  const contractPayload = base58CheckDecode(USDT_CONTRACT);
  const contractHex = bytesToHex(contractPayload);

  const toPayload = base58CheckDecode(COLD_WALLET);
  const toHex = bytesToHex(toPayload);

  console.log(`owner_hex: ${ownerHex}`);
  console.log(`contract_hex: ${contractHex}`);
  console.log(`to_hex: ${toHex}`);

  // Encode transfer parameter
  // transfer(address,uint256): address left-padded to 32 bytes, uint256 32 bytes
  const addrParam = "000000000000000000000000" + toHex; // 12 bytes padding + 20 bytes address
  const valueParam = "00000000000000000000000000000000000000000000000000000000000f4240"; // 1,000,000 = 1 USDT
  const parameter = addrParam + valueParam;

  console.log(`parameter: ${parameter.substring(0, 64)}...`);

  // Build raw transaction manually
  const rawData = {
    ref_block_bytes: blockHash.slice(0, 16),
    ref_block_hash: blockHash.slice(16, 32),
    expiration: timestamp + 60_000, // 1 minute from now
    contract: [
      {
        type: "TriggerSmartContract",
        parameter: {
          value: {
            data: parameter,
            owner_address: ownerHex,
            contract_address: contractHex,
            call_value: 0,
            call_token_value: 0,
            token_id: 0,
          },
          type_url: "type.googleapis.com/protocol.TriggerSmartContract",
        },
      },
    ],
    fee_limit: 18_000_000,
    timestamp,
  };

  console.log("Raw data:", JSON.stringify(rawData, null, 2).slice(0, 1000));

  // Actually we need to use wallet/triggersmartcontract which builds the tx properly
  // and then sign its result. Let's try directly:
  console.log("\n--- Attempt via wallet/triggersmartcontract ---");
  const triggerRes = await fetch(`${API}/wallet/triggersmartcontract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_address: ownerHex,
      contract_address: contractHex,
      function_selector: "transfer(address,uint256)",
      parameter: parameter,
      fee_limit: 18_000_000,
      call_value: 0,
      visible: false,
    }),
  });
  const triggerResult: any = await triggerRes.json();
  console.log("Trigger response:", JSON.stringify(triggerResult, null, 2).slice(0, 2000));

  if (triggerResult.Error) {
    console.log("\n❌ Error:", triggerResult.Error);
    // Try without 'visible: false'
    console.log("\n--- Retry without visible field ---");
    const triggerRes2 = await fetch(`${API}/wallet/triggersmartcontract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_address: ownerHex,
        contract_address: contractHex,
        function_selector: "transfer(address,uint256)",
        parameter: parameter,
        fee_limit: 18_000_000,
        call_value: 0,
      }),
    });
    const triggerResult2 = await triggerRes2.json();
    console.log("Trigger response 2:", JSON.stringify(triggerResult2, null, 2).slice(0, 2000));
    process.exit(0);
  }

  if (!triggerResult.transaction) {
    console.log("\n❌ No transaction in response");
    process.exit(0);
  }

  // Sign the transaction
  console.log("\nSigning transaction...");
  const tx = triggerResult.transaction;
  const rawDataHex = bytesToHex(
    new Uint8Array(
      (tx.raw_data_hex || JSON.stringify(tx.raw_data)).split("").map((c: string) => c.charCodeAt(0))
    )
  );
  
  // Actually tron uses protobuf-serialized raw_data bytes
  // The proper way: sign tx.raw_data_hex if present
  let rawDataSerialized: Uint8Array;
  if (tx.raw_data_hex) {
    rawDataSerialized = hexToBytes(tx.raw_data_hex);
  } else {
    console.log("No raw_data_hex, trying to sign the transaction object directly...");
    // Continue with tronweb signing approach - but we have the tx here
    // Let's try the manual protobuf approach
    console.log(JSON.stringify(tx, null, 2).slice(0, 1000));
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
