/**
 * Fix: send 18 TRX to deposit, then force-sweep USDT.
 */
import { getTron } from "@/lib/tron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const tron = getTron();
  const depositAddress = "TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu";
  const coldAddress = "TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW";
  
  try {
    // 1. Top up with 18 TRX
    const hot = tron.hotSigner();
    console.log("Checking hot wallet balance...");
    const hotTrx = await tron.trxBalanceSun(hot.address);
    console.log(`Hot TRX: ${hotTrx}`);
    
    // Need to send 18 TRX but we have ~14.5 after prev tx
    // Send what we can
    const topUpAmount = hotTrx > 18_000_000n ? 18_000_000n : hotTrx - 1_000_000n; // keep 1 TRX on hot
    console.log(`Sending ${topUpAmount/1_000_000n} TRX to deposit...`);
    
    const topUp = await tron.sendTrx({
      fromAddress: hot.address,
      toAddress: depositAddress,
      amountSun: topUpAmount,
      signer: hot,
    });
    console.log(`Top-up: ${topUp.txHash}`);
    
    // 2. Wait for top-up to land
    await new Promise(r => setTimeout(r, 10_000));
    
    // 3. Now sweep using signerForIndex(7)
    const signer = tron.signerForIndex(7);
    const usdt = await tron.usdtBalance(depositAddress);
    console.log(`USDT on deposit: ${usdt}`);
    
    const result = await tron.sendUsdt({
      fromAddress: depositAddress,
      toAddress: coldAddress,
      amount: usdt,
      signer,
    });
    
    return Response.json({
      ok: true,
      topUpTx: topUp.txHash,
      sweepTx: result.txHash,
      from: depositAddress,
      to: coldAddress,
      amount: usdt,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: String(err).slice(0, 500),
    });
  }
}
