import { getDb } from "@/db/client";
import { invoices, users, commissionLedger, subscriptions } from "@/db/schema";
import { eq, sql, and, gt } from "drizzle-orm";

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

    // Check if TXID 789477d6... already exists somewhere
    const txCheck = await db
      .select({ id: invoices.id, userId: invoices.userId, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.paidTxHash, "789477d6bbd219ccd94d9f47f6a0e85565807795ecb34e95fe6bf22237a7dca3"))
      .limit(1)
      .then((r) => r[0] ?? null);
    log(`TX789477 DB check: ${txCheck ? `inv=${txCheck.id?.slice?.(0,8)} user=${txCheck.userId?.slice?.(0,8)} status=${txCheck.status}` : "NOT_FOUND"}`);

    // Check if chilli (e8cd7ec1) has active sub
    const chilliSub = await db
      .select({ id: subscriptions.id, status: subscriptions.status })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, invoice.userId), eq(subscriptions.status, "active"), gt(subscriptions.endsAt, new Date())))
      .limit(1)
      .then((r) => r[0] ?? null);
    log(`CHILLI has active sub: ${chilliSub ? `sub=${chilliSub.id?.slice?.(0,8)} status=${chilliSub.status}` : "NO"}`);

  } catch (err: any) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
    log(`ERROR: ${msg}`);
    return Response.json({ status: "error", error: msg, logs });
  }

  return Response.json({ status: "ok", logs });
}
