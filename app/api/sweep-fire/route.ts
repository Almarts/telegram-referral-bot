import { processSweeps } from "@/lib/sweep";
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTron } from "@/lib/tron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const tron = getTron();

  const inv = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, "6eb4de20-f078-4cd8-8a01-090c59e0f29c"))
    .limit(1)
    .then(r => r[0]);

  const address = inv?.depositAddress;
  const usdtBalance = address ? await tron.usdtBalance(address) : "no addr";
  const trxBalanceSun = address ? (await tron.trxBalanceSun(address)).toString() : "no addr";

  // Try sending 1 TRX for activation
  let sendResult: any = "not attempted";
  try {
    const hotSigner = tron.hotSigner();
    sendResult = {
      hotAddress: hotSigner.address,
      balUsdt: await tron.usdtBalance(hotSigner.address),
      balTrx: (await tron.trxBalanceSun(hotSigner.address)).toString(),
    };
    // Actually try to send
    const topUp = await tron.sendTrx({
      fromAddress: hotSigner.address,
      toAddress: address!,
      amountSun: 1_000_000n, // 1 TRX
      signer: hotSigner,
    });
    sendResult.txHash = topUp.txHash;
    sendResult.success = true;
  } catch (e: any) {
    sendResult = { error: e.message ?? String(e), stack: (e.stack ?? "").slice(0, 300) };
  }

  return Response.json({
    depositAddress: address,
    usdtBalance,
    trxBalanceSun,
    sendResult,
    processSweepsResult: await processSweeps(),
    ts: new Date().toISOString(),
  });
}
