import "dotenv/config";
import { getTronWeb } from "../lib/tron/tronweb-client";

async function main() {
  const tron = getTronWeb(process.env.TRONGRID_API_KEY!);
  
  // Последний депозит реферала — проверяю все депозиты
  console.log("--- All deposit addresses ---");
  for (let i = 0; i < 20; i++) {
    try {
      const { address } = tron.deriveDepositAddress(i);
      const u = await tron.getUsdtBalance(address);
      const t = await tron.getBalance(address);
      if (parseFloat(u) > 0 || t > 0) {
        console.log(`  derivIndex=${i}: ${address} — USDT=${u}, TRX=${t}`);
      }
    } catch (e) {
      // skip
    }
  }
  
  // Отдельно последний известный
  const depositAddr = "TBjJ52bUqQZorMBrHP4kekepDLbgmJgBwo";
  const trxBal = await tron.getBalance(depositAddr);
  const usdtBal = await tron.getUsdtBalance(depositAddr);
  console.log(`\n--- Requested: ${depositAddr} ---`);
  console.log(`  TRX: ${trxBal}`);
  console.log(`  USDT: ${usdtBal}`);
}

main().catch(console.error);
