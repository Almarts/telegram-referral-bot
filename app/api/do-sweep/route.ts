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

  // Find the unswept invoice
  const toSweep = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.status, "paid"), eq(invoices.swept, false)))
    .limit(1);

  if (toSweep.length === 0) {
    return new Response(JSON.stringify({ error: "no unswept invoices" }), { status: 200 });
  }

  const inv = toSweep[0];
  const address = inv.depositAddress;

  const usdtBalance = await tron.usdtBalance(address!);
  const trxBalanceSun = await tron.trxBalanceSun(address!);
  const hotSigner = tron.hotSigner();
  const signer = tron.signerForIndex(inv.derivIndex);

  const logs: any[] = [];

  // Try sending TRX first
  logs.push({ step: "sending TRX", from: hotSigner.address, to: address, amount: 2_000_000 });
  try {
    const topUp = await tron.sendTrx({
      fromAddress: hotSigner.address,
      toAddress: address!,
      amountSun: 2_000_000n,
      signer: hotSigner,
    });
    logs.push({ step: "TRX sent", txHash: topUp.txHash });
  } catch (e: any) {
    logs.push({ step: "TRX failed", error: e.message });
  }

  // Try sending USDT
  logs.push({ step: "sending USDT", from: address, to: coldAddress, amount: inv.amountUsdt });
  try {
    const tx = await tron.sendUsdt({
      fromAddress: address!,
      toAddress: coldAddress,
      amount: inv.amountUsdt,
      signer,
    });
    logs.push({ step: "USDT sent", txHash: tx.txHash });

    // Check if tx exists on chain
    const existsUrl = `https://api.trongrid.io/v1/transactions/${tx.txHash}`;
    const checkRes = await fetch(existsUrl, { headers: { Accept: "application/json" } });
    const checkBody = await checkRes.json();
    const exists = Array.isArray(checkBody.data) && checkBody.data.length > 0;
    logs.push({ step: "verify", exists });

    if (exists) {
      await db
        .update(invoices)
        .set({ swept: true, sweepTxHash: tx.txHash })
        .where(and(eq(invoices.id, inv.id), eq(invoices.swept, false)));
      logs.push({ step: "DB updated" });
    }
  } catch (e: any) {
    logs.push({ step: "USDT failed", error: e.message });
  }

  return new Response(
    JSON.stringify({
      invoice: { id: inv.id, address, usdtBalance, trxBalanceSun: trxBalanceSun.toString() },
      coldWallet: { address: coldAddress, usdt: await tron.usdtBalance(coldAddress) },
      hotWallet: { address: hotSigner.address },
      logs,
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
