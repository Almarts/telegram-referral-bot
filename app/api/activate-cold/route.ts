/**
 * TEMP: activate cold wallet by sending 1 TRX.
 */
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const tron = getTron();
  const env = getEnv();
  
  try {
    const hot = tron.hotSigner();
    console.log(`Sending 1 TRX from ${hot.address} to ${env.TRON_COLD_WALLET_ADDRESS}...`);
    const result = await tron.sendTrx({
      fromAddress: hot.address,
      toAddress: env.TRON_COLD_WALLET_ADDRESS,
      amountSun: 1_000_000n, // 1 TRX
      signer: hot,
    });
    
    return Response.json({
      ok: true,
      txHash: result.txHash,
      from: hot.address,
      to: env.TRON_COLD_WALLET_ADDRESS,
      amount: "1 TRX",
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: String(err).slice(0, 500),
    });
  }
}
