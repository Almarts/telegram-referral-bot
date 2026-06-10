/**
 * Direct force-sweep using signerForIndex(7).
 * Sends 1 USDT from TD7nWpy... to cold wallet.
 */
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const tron = getTron();
  const env = getEnv();
  
  try {
    const signer = tron.signerForIndex(7);
    const depositAddr = signer.address;
    console.log(`Deposit signer address: ${depositAddr}`);
    
    // Check deposit balance
    const usdt = await tron.usdtBalance(depositAddr);
    const trx = await tron.trxBalanceSun(depositAddr);
    console.log(`Deposit: ${usdt} USDT, ${trx} TRX sun`);
    
    if (usdt === "0.000000" || usdt === "0") {
      return Response.json({ error: "No USDT on deposit", address: depositAddr, usdt, trx: trx.toString() });
    }
    
    // Send to cold
    const result = await tron.sendUsdt({
      fromAddress: depositAddr,
      toAddress: env.TRON_COLD_WALLET_ADDRESS,
      amount: usdt, // send whatever is there
      signer,
    });
    
    return Response.json({
      ok: true,
      txHash: result.txHash,
      from: depositAddr,
      to: env.TRON_COLD_WALLET_ADDRESS,
      amount: usdt,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: String(err).slice(0, 500),
    });
  }
}
