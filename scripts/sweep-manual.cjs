const { TronWeb } = require("tronweb");

const apiKey = "a844cffc-c750-41da-9aee-578adc95f2ce";
const xprv = "xprv9zYYzzUMrGjJTXMKEhG56ayTmr42ELAqTZyBphiUye7tJWX7jcoVEHNcSur2152UEms8AxJX1Vj9sV9MrgqCjAin3Md8iV2KBHGyuBZ1zZ6";

async function main() {
  const tw = new TronWeb({
    fullHost: "https://api.trongrid.io",
    headers: { "TRON-PRO-API-KEY": apiKey },
  });

  // Derive deposit private key for derivIndex=8
  // Using @scure/bip32 
  const { HDKey } = require("@scure/bip32");
  const master = HDKey.fromExtendedKey(xprv);
  const child = master.derive("m/44'/195'/0'/0/8");
  const depositPk = child.privateKey;
  
  if (!depositPk) {
    console.error("No private key derived");
    return;
  }
  
  const depositPkHex = Buffer.from(depositPk).toString("hex");
  console.log("Deposit PK:", depositPkHex.slice(0, 16) + "...");
  
  tw.setPrivateKey(depositPkHex);
  const depositAddr = tw.address.fromPrivateKey(depositPkHex);
  console.log("Deposit address:", depositAddr);
  
  // Check balance
  const usdtBal = await tw.trx.getBalance(depositAddr); // TRX
  console.log(`TRX: ${usdtBal / 1e6}`);
  
  // Check USDT
  const contractAddr = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
  const usdt = await tw.trx.getTokenBalance(contractAddr, depositAddr);
  console.log(`USDT: ${usdt}`);
  
  // Send USDT to cold
  const coldAddr = "TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW";
  console.log(`\nSending USDT to ${coldAddr}...`);
  
  const tx = await tw.transactionBuilder.triggerConstantContract(
    tw.address.toHex(contractAddr),
    "transfer(address,uint256)",
    {},
    [
      { type: "address", value: coldAddr },
      { type: "uint256", value: 1_000_000 }, // 1 USDT
    ],
    tw.address.toHex(depositAddr)
  );
  
  const signed = await tw.trx.sign(tx.transaction, depositPkHex);
  
  const res = await fetch("https://api.trongrid.io/wallet/broadcasttransaction", {
    method: "POST",
    headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": apiKey },
    body: JSON.stringify({
      raw_data: tx.transaction.raw_data,
      signature: signed.signature,
    }),
  });
  
  const result = await res.json();
  console.log("Result:", JSON.stringify(result, null, 2));
  
  if (result.result) {
    console.log("\n✅ USDT sent! TX:", result.txid);
  }
}

main().catch(e => console.error("ERR:", e.message || e));
