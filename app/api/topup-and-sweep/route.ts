/**
 * TEMP: top up deposit address with TRX, then sweep.
 */
import { getTron } from "@/lib/tron";
import { processSweeps } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const tron = getTron();
  const depositAddress = "TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu";
  
  try {
    // Send 2 TRX to deposit address for gas
    const hot = tron.hotSigner();
    console.log(`Sending 2 TRX to ${depositAddress}...`);
    const tx = await tron.sendTrx({
      fromAddress: hot.address,
      toAddress: depositAddress,
      amountSun: 2_000_000n,
      signer: hot,
    });
    console.log(`Top-up tx: ${tx.txHash}`);
    
    // Wait a moment then run sweep
    await new Promise(r => setTimeout(r, 5000));
    
    const swept = await processSweeps();
    return Response.json({ topUpTx: tx.txHash, swept });
  } catch (err) {
    return Response.json({ ok: false, error: String(err).slice(0, 500) });
  }
}
