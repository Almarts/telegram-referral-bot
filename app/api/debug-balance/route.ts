import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getTron } from "@/lib/tron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const tron = getTron();

  // Найди платный инвойс
  const paid = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.status, "paid"), eq(invoices.swept, true)))
    .limit(5);

  // Все инвойсы
  const all = await db.select().from(invoices).limit(10);

  let balances: any[] = [];

  for (const inv of paid.slice(0, 3)) {
    try {
      const usdt = await tron.usdtBalance(inv.depositAddress!);
      const trx = await tron.trxBalanceSun(inv.depositAddress!);
      balances.push({
        id: inv.id,
        address: inv.depositAddress,
        usdtBalance: usdt,
        trxBalanceSun: trx.toString(),
        sweepTxHash: inv.sweepTxHash,
        amountUsdt: inv.amountUsdt,
        swept: inv.swept,
        paidAt: inv.paidAt,
      });
    } catch (e: any) {
      balances.push({ id: inv.id, error: e.message });
    }
  }

  return Response.json({
    paid: paid.map((p) => ({
      id: p.id,
      amountUsdt: p.amountUsdt,
      depositAddress: p.depositAddress,
      swept: p.swept,
      sweepTxHash: p.sweepTxHash,
      paidAt: p.paidAt,
      status: p.status,
    })),
    all: all.map((a) => ({
      id: a.id,
      status: a.status,
      amountUsdt: a.amountUsdt,
      swept: a.swept,
    })),
    balances,
    coldWalletCheck: await tron.usdtBalance("TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW"),
  });
}
