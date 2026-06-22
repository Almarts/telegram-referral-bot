import { getDb } from "@/db/client";
import { invoices, users, commissionLedger } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const logs: string[] = [];
  const log = (m: string) => { console.log("TEST_COMMISSION:", m); logs.push(m); };

  try {
    // Find the latest paid invoice
    const invoice = await db
      .select()
      .from(invoices)
      .where(eq(invoices.status, "paid"))
      .orderBy(sql`${invoices.paidAt} desc`)
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!invoice) {
      log("No paid invoice found");
      return Response.json({ status: "no_invoice", logs });
    }
    log(`Invoice: ${invoice.id} amount=${invoice.amountUsdt}`);

    // Find buyer
    const buyer = await db
      .select({ id: users.id, parentRefCode: users.parentRefCode })
      .from(users)
      .where(eq(users.id, invoice.userId))
      .limit(1)
      .then((r) => r[0] ?? null);
    log(`Buyer: ${buyer?.id?.slice?.(0,8) ?? "null"} parent=${buyer?.parentRefCode ?? "null"}`);

    if (!buyer?.parentRefCode) {
      log("No parentRefCode - buyer is not a referral");
      return Response.json({ status: "no_parent", logs });
    }

    // Find L1
    const l1 = await db
      .select({ id: users.id, refCode: users.refCode, parentRefCode: users.parentRefCode })
      .from(users)
      .where(eq(users.refCode, buyer.parentRefCode))
      .limit(1)
      .then((r) => r[0] ?? null);
    log(`L1: ${l1?.id?.slice?.(0,8) ?? "null"} role check needed`);

    if (!l1) {
      log("No L1 found");
      return Response.json({ status: "no_l1", logs });
    }

    // Check commission_config
    const { commissionConfig } = await import("@/db/schema");
    const config = await db
      .select()
      .from(commissionConfig)
      .limit(1)
      .then((r) => r[0] ?? null);
    log(`Config exists: ${!!config}`);

    if (!config) {
      log("No commission config");
      return Response.json({ status: "no_config", logs });
    }

    // Count existing commissions for this invoice
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(commissionLedger)
      .where(eq(commissionLedger.invoiceId, invoice.id));
    log(`Existing commissions for this invoice: ${existing[0]?.count ?? 0}`);

  } catch (err: any) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
    log(`ERROR: ${msg}`);
    return Response.json({ status: "error", error: msg, logs });
  }

  return Response.json({ status: "ok", logs });
}
