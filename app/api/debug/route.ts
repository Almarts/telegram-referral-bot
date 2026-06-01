import { getLastBotError } from "@/app/api/tg/webhook/route";
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const err = getLastBotError();
  const env = getEnv();

  const db = getDb();
  const tron = getTron();

  // Paid invoices
  const paid = await db
    .select({
      id: invoices.id,
      amountUsdt: invoices.amountUsdt,
      depositAddress: invoices.depositAddress,
      derivIndex: invoices.derivIndex,
      swept: invoices.swept,
      sweepTxHash: invoices.sweepTxHash,
      paidAt: invoices.paidAt,
      status: invoices.status,
    })
    .from(invoices)
    .where(eq(invoices.status, "paid"))
    .limit(10);

  // Cold wallet
  const coldUsdt = await tron.usdtBalance(env.TRON_COLD_WALLET_ADDRESS);
  const coldTrx = await tron.trxBalanceSun(env.TRON_COLD_WALLET_ADDRESS);

  // Deposit balances for paid invoices
  const depositBalances: any[] = [];
  for (const inv of paid) {
    if (!inv.depositAddress) continue;
    try {
      depositBalances.push({
        id: inv.id,
        address: inv.depositAddress,
        usdt: await tron.usdtBalance(inv.depositAddress),
        trx: (await tron.trxBalanceSun(inv.depositAddress)).toString(),
      });
    } catch (e: any) {
      depositBalances.push({ id: inv.id, address: inv.depositAddress, error: e.message });
    }
  }

  // All invoices (recent 20)
  const all = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      amountUsdt: invoices.amountUsdt,
      swept: invoices.swept,
      depositAddress: invoices.depositAddress,
      sweepTxHash: invoices.sweepTxHash,
    })
    .from(invoices)
    .orderBy(invoices.createdAt)
    .limit(20);

  return new Response(
    JSON.stringify(
      {
        lastBotError: err,
        hasError: err !== null,
        coldWallet: {
          address: env.TRON_COLD_WALLET_ADDRESS,
          usdt: coldUsdt,
          trx: coldTrx.toString(),
        },
        paidInvoices: paid,
        depositBalances,
        allInvoices: all,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
