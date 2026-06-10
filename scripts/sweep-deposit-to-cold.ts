/**
 * Manual sweep: send 1 USDT from deposit address TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu (derivIndex=7)
 * to cold wallet TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW
 *
 * feeLimit temporarily lowered to 2_000_000 in real.ts — deposit has 14.15 TRX,
 * not enough for 18 TRX limit. Real fee burned ~0.34 TRX.
 */
import { HDKey } from "@scure/bip32";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local
config({ path: resolve(__dirname, "..", ".env.local") });

const XPRV = process.env.TRON_DEPOSIT_XPRV;
if (!XPRV) throw new Error("TRON_DEPOSIT_XPRV not set");

const DEPOSIT_INDEX = 7; // TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu
const COLD_WALLET = "TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW";
const USDT_AMOUNT = "1.0";

async function main() {
  const hdkey = HDKey.fromExtendedKey(XPRV);
  const child = hdkey.derive(`m/44'/195'/0'/0/${DEPOSIT_INDEX}`);
  if (!child.publicKey || !child.privateKey) {
    throw new Error(`Failed to derive keys at index ${DEPOSIT_INDEX}`);
  }

  const { tronAddressFromPublicKey } = await import("../lib/tron/real");
  const depositAddress = tronAddressFromPublicKey(child.publicKey);
  console.log(`Deposit address (index=${DEPOSIT_INDEX}): ${depositAddress}`);

  const privateKeyHex = Buffer.from(child.privateKey).toString("hex");
  console.log(`Private key derived (${privateKeyHex.length} hex chars)`);

  // Check balance first
  console.log("Checking balances...");
  const accRes = await fetch(`https://api.trongrid.io/v1/accounts/${depositAddress}`);
  const accData = await accRes.json();
  const balance = accData.data?.[0]?.balance ?? 0;
  const trc20 = accData.data?.[0]?.trc20 ?? [];
  const usdtEntry = trc20.find((t: Record<string, string>) =>
    Object.keys(t)[0] === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
  );
  const usdtBalance = usdtEntry ? Number(Object.values(usdtEntry)[0]) : 0;
  console.log(`TRX: ${balance / 1e6}, USDT: ${usdtBalance / 1e6}`);

  if (usdtBalance === 0) {
    console.log("No USDT to sweep.");
    return;
  }

  // Use rawUsdtTransfer via TronWeb
  const { getTronWeb } = await import("../lib/tron/tronweb-client");
  const apiKey = process.env.TRONGRID_API_KEY;
  if (!apiKey) throw new Error("TRONGRID_API_KEY not set");
  const tw = await getTronWeb(apiKey);

  const atomicAmount = BigInt(usdtBalance);
  const usdtHex = tw.address.toHex("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
  const fromHex = tw.address.toHex(depositAddress);
  const toHex = tw.address.toHex(COLD_WALLET);

  console.log(`Sending ${usdtBalance / 1e6} USDT to ${COLD_WALLET}...`);

  // With feeLimit=18_000_000 — try full limit to cover energy cost
  const built: any = await tw.transactionBuilder.triggerConstantContract(
    usdtHex,
    "transfer(address,uint256)",
    { feeLimit: 18_000_000 },
    [
      { type: "address", value: toHex },
      { type: "uint256", value: atomicAmount.toString() },
    ],
    fromHex,
  );

  if (!built.result?.result) {
    throw new Error(`triggerConstantContract failed: ${JSON.stringify(built)}`);
  }

  const tx = built.transaction;

  // Sign
  const signed = await tw.trx.sign(tx, privateKeyHex);
  const sigHex: string = signed.signature?.[0] ?? "";
  if (!sigHex) {
    throw new Error("No signature in tronweb signed result");
  }

  // Broadcast
  console.log("Broadcasting...");
  const broadcastRes = await fetch(
    "https://api.trongrid.io/wallet/broadcasttransaction",
    {
      method: "POST",
      headers: {
        "TRON-PRO-API-KEY": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        raw_data: tx.raw_data,
        signature: [sigHex],
      }),
    },
  );

  const result = await broadcastRes.json();
  console.log("Broadcast result:", JSON.stringify(result, null, 2));

  if (result.result === true && result.txid) {
    console.log(`\n✅ SUCCESS! TxHash: ${result.txid}`);
    console.log(`🔗 https://tronscan.org/#/transaction/${result.txid}`);
  } else {
    const msg = result.message
      ? Buffer.from(result.message, "base64").toString()
      : "?";
    console.log(`\n❌ Broadcast failed: code=${result.code} message=${msg}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
