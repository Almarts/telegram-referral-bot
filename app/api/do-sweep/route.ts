import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const db = getDb();
  const tron = getTron();
  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;

  const toSweep = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.status, "paid"), eq(invoices.swept, false)))
    .limit(1);

  if (toSweep.length === 0) {
    return new Response(JSON.stringify({ error: "no unswept invoices" }), { status: 200 });
  }

  const inv = toSweep[0];
  const address = inv.depositAddress!;

  // Send exactly 1 TRX (1 sun = 1 drop, 1 TRX = 1_000_000 sun)
  const hotSigner = tron.hotSigner();
  const topUp = await tron.sendTrx({
    fromAddress: hotSigner.address,
    toAddress: address,
    amountSun: 1_000_000n,
    signer: hotSigner,
  });
  
  // Wait a moment for the tx to land
  await new Promise(r => setTimeout(r, 5000));
  
  // Check if deposit has enough TRX now
  const trxBal = await tron.trxBalanceSun(address);
  
  // Now try USDT transfer
  const signer = tron.signerForIndex(inv.derivIndex);
  
  let usdtResult: any = null;
  try {
    const tx = await tron.sendUsdt({
      fromAddress: address,
      toAddress: coldAddress,
      amount: inv.amountUsdt,
      signer,
    });
    
    // Wait and check if it lands
    await new Promise(r => setTimeout(r, 8000));
    
    const checkUrl = `https://api.trongrid.io/v1/transactions/${tx.txHash}`;
    const checkRes = await fetch(checkUrl, { headers: { Accept: "application/json" } });
    const checkBody = await checkRes.json();
    const exists = Array.isArray(checkBody.data) && checkBody.data.length > 0;
    usdtResult = { txHash: tx.txHash, exists };
    
    if (exists) {
      await db.update(invoices)
        .set({ swept: true, sweepTxHash: tx.txHash })
        .where(and(eq(invoices.id, inv.id), eq(invoices.swept, false)));
    }
  } catch (e: any) {
    usdtResult = { error: e.message };
  }

  return new Response(JSON.stringify({
    address,
    hotBalance: (await tron.trxBalanceSun(hotSigner.address)).toString(),
    depositBalance: trxBal.toString(),
    topUpTx: topUp.txHash,
    usdtResult,
    coldUsdt: await tron.usdtBalance(coldAddress),
  }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
}
