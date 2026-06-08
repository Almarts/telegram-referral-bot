// Override do-sweep to send small test amount first
const fs = await import('fs');

const content = `import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";
import { usdtToAtomic } from "@/lib/tron/real";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const db = getDb();
  const tron = getTron();
  const coldAddress = "TRHUJ6KtbavBx1CtuXwenYurbZHMW1zPhE";

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
  
  // Now try USDT transfer — send only 0.01 USDT first (test amount)
  const signer = tron.signerForIndex(inv.derivIndex);
  
  let usdtResult: any = null;
  try {
    // Send just 0.01 USDT to test
    const tx = await tron.sendUsdt({
      fromAddress: address,
      toAddress: coldAddress,
      amount: "0.010000",
      signer,
    });
    
    // Wait and check if it lands
    await new Promise(r => setTimeout(r, 8000));
    
    const checkUrl = \`https://api.trongrid.io/v1/transactions/\${tx.txHash}\`;
    const checkRes = await fetch(checkUrl, { headers: { Accept: "application/json" } });
    const checkBody = await checkRes.json();
    const exists = Array.isArray(checkBody.data) && checkBody.data.length > 0;
    usdtResult = { txHash: tx.txHash, exists };
    
    if (exists) {
      await db.update(invoices)
        .set({ swept: true, sweepTxHash: tx.txHash })
        .where(and(eq(invoices.id, inv.id), eq(invoices.swept, false)));
      console.log("do-sweep: test transfer succeeded, invoice marked as swept");
    }
  } catch (e: any) {
    usdtResult = { error: e.message?.slice(0, 500) || String(e).slice(0, 500) };
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
`;

await fs.promises.writeFile(
  'C:/Users/marts/projects/telegram-referral-bot-main/app/api/do-sweep/route.ts',
  content,
  'utf8'
);
console.log('Written');
