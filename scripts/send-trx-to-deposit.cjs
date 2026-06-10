const { TronWeb } = require("tronweb");

const apiKey = "a844cffc-c750-41da-9aee-578adc95f2ce";
const hotPk = "e3e7ee25b9cd22256a9a83f597277a321a6a665bf784d7ebd315870e39298dcb";

async function main() {
  const tw = new TronWeb({
    fullHost: "https://api.trongrid.io",
    headers: { "TRON-PRO-API-KEY": apiKey },
    privateKey: hotPk,
  });

  const hotAddr = tw.address.fromPrivateKey(hotPk);
  console.log("Hot:", hotAddr);

  const bal = await tw.trx.getBalance(hotAddr);
  console.log(`Hot TRX: ${bal / 1e6}`);

  // REAL deposit address from DB
  const depositAddr = "TN8sYb6UPtJrECPekQqZmyrooZ4QPWHNTu";
  console.log(`Sending 18 TRX to real deposit: ${depositAddr}...`);

  const fromHex = "417fa217ad87a5c6a800c1b4cd729c3207b981670e"; // hot hex
  const toHex = tw.address.toHex(depositAddr);
  console.log("toHex:", toHex);

  const createRes = await fetch("https://api.trongrid.io/wallet/createtransaction", {
    method: "POST",
    headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": apiKey },
    body: JSON.stringify({ owner_address: fromHex, to_address: toHex, amount: 18_000_000 }),
  });
  const tx = await createRes.json();
  if (tx.Error || !tx.raw_data) {
    console.error("Create failed:", tx);
    return;
  }

  const signed = await tw.trx.sign(tx, hotPk);
  const broadcastRes = await fetch("https://api.trongrid.io/wallet/broadcasttransaction", {
    method: "POST",
    headers: { "Content-Type": "application/json", "TRON-PRO-API-KEY": apiKey },
    body: JSON.stringify({ raw_data: tx.raw_data, signature: signed.signature }),
  });
  const result = await broadcastRes.json();
  console.log("Result:", JSON.stringify(result, null, 2));

  if (result.result) {
    console.log(`\n✅ TX: ${result.txid}`);

    await new Promise(r => setTimeout(r, 5000));

    // Check deposit
    const depBal = await tw.trx.getBalance(depositAddr);
    console.log(`Deposit TRX now: ${depBal / 1e6}`);
  }
}

main().catch(e => console.error("ERR:", e.message || e));
