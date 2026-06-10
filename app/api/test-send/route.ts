/**
 * TEMP: direct test of safety-rail USDT send.
 * Sends 0.5 USDT from hot wallet to cold wallet.
 */
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const tron = getTron();
  const env = getEnv();
  
  try {
    console.log("Sending 0.5 USDT from hot to cold...");
    const result = await tron.sendUsdt({
      fromAddress: tron.hotSigner().address,
      toAddress: env.TRON_COLD_WALLET_ADDRESS,
      amount: "0.500000",
      signer: tron.hotSigner(),
    });
    
    return Response.json({
      ok: true,
      txHash: result.txHash,
      from: tron.hotSigner().address,
      to: env.TRON_COLD_WALLET_ADDRESS,
      amount: "0.500000",
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: String(err).slice(0, 500),
    });
  }
}
