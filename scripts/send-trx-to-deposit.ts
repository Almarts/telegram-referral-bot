import "dotenv/config";
import { TronWeb } from "tronweb";

async function main() {
  const apiKey = process.env.TRONGRID_API_KEY!;
  const hotPk = process.env.TRON_HOT_WALLET_PK!;
  
  const tw = new TronWeb({
    fullHost: "https://api.trongrid.io",
    headers: { "TRON-PRO-API-KEY": apiKey },
    privateKey: hotPk,
  });

  const hotAddr = tw.address.fromPrivateKey(hotPk);
  console.log("Hot address:", hotAddr);

  const bal = await tw.trx.getBalance(hotAddr);
  console.log(`Hot TRX: ${bal / 1e6}`);

  const depositAddr = "TN8sYb6UPt5M4zAJo94Q5sCn8HhYGw9Dqk";
  console.log(`Sending 18 TRX to ${depositAddr}...`);

  const result = await tw.trx.sendTransaction(depositAddr, 18_000_000);
  console.log("Send result:", JSON.stringify(result, null, 2));

  const depBal = await tw.trx.getBalance(depositAddr);
  console.log(`Deposit TRX: ${depBal / 1e6}`);
}

main().catch((e: any) => console.error("ERR:", e.message || e));
