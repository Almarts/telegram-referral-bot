import { getDb } from "@/db/client";
import { invoices, users, commissionLedger, subscriptions, commissionConfig } from "@/db/schema";
import { eq, sql, and, gt } from "drizzle-orm";
import { accrueCommissions } from "@/lib/commissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const logs: string[] = [];
  const log = (m: string) => { console.log("ACCRUE_DEBUG:", m); logs.push(m); };

  try {
    // Find latest paid invoice
    const invoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.status, "paid"))
      .orderBy(sql`${invoices.paidAt} desc`)
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!invoice) { log("No paid invoice"); return Response.json({ status: "no_invoice", logs }); }
    log(`Invoice: ${invoice.id} amount=${invoice.amountUsdt}`);

    // Try to call accrueCommissions directly
    log("Calling accrueCommissions...");
    try {
      await accrueCommissions(invoice.id);
      log("accrueCommissions completed without error");
    } catch (e: any) {
      log(`accrueCommissions THREW: ${e.name}: ${e.message}`);
      log(`Stack: ${(e.stack || "").slice(0, 300)}`);
    }

    // Check if commission was created
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(commissionLedger)
      .where(eq(commissionLedger.invoiceId, invoice.id));
    log(`Commissions after call: ${existing[0]?.count ?? 0}`);

  } catch (e: any) {
    log(`FATAL: ${e.name}: ${e.message}`);
    if (e.stack) log(`STACK: ${e.stack.slice(0, 300)}`);
  }

  return Response.json({ status: "ok", logs });
}
