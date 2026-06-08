import { TronWeb } from "tronweb";

async function debug() {
  const tw = new TronWeb({
    fullHost: "https://api.trongrid.io",
    headers: { "TRON-PRO-API-KEY": "a36b98ca-c158-4fa0-afde-5979c5a5a583" },
  });

  const built = await tw.transactionBuilder.triggerSmartContract(
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    "transfer(address,uint256)",
    { feeLimit: 100_000_000, callValue: 0 },
    [
      { type: "address", value: "TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW" },
      { type: "uint256", value: "9990000" },
    ],
    "TUXiP52qojHWniQEfssSZ5GRkvcVJcAfE8",
  );

  const tx = built.transaction;

  console.log("raw_data keys:", Object.keys(tx.raw_data));
  const contract = tx.raw_data.contract?.[0];
  console.log("contract:", JSON.stringify(Object.keys(contract || {})));

  const val = contract?.parameter?.value;
  console.log("value keys:", Object.keys(val || {}));
  console.log("data type:", typeof val?.data);
  console.log("data constructor:", val?.data?.constructor?.name);
  console.log("data is Uint8Array:", val?.data instanceof Uint8Array);

  // Check if data.toString works
  if (val?.data) {
    const dataStr = Buffer.from(val.data).toString("hex");
    console.log("data hex length:", dataStr.length);
    console.log("data hex:", dataStr.slice(0, 80));
  }

  console.log("\nref_block_bytes type:", typeof tx.raw_data.ref_block_bytes);
  console.log("ref_block_hash type:", typeof tx.raw_data.ref_block_hash);
  console.log("expiration type:", typeof tx.raw_data.expiration);
  console.log("timestamp type:", typeof tx.raw_data.timestamp);
  
  // Check non-enumerable properties
  console.log("\nAll own properties of raw_data:");
  for (const key of Object.getOwnPropertyNames(tx.raw_data)) {
    const v = tx.raw_data[key];
    console.log(`  ${key}: ${typeof v} (${v?.constructor?.name || "?"})`);
  }

  // Try to serialize value
  const replacer = (k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
    return v;
  };
  console.log("\nFull value (JSON):");
  console.log(JSON.stringify(val, replacer, 2).slice(0, 1000));
}

debug().catch(console.error);
