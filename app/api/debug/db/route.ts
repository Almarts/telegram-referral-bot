import { getDb } from "@/db/client";
import { users, invoices, subscriptions, commissionLedger } from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const results: string[] = [];
  const db = getDb();

  // Test each query individually
  try {
    const r = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .then((r) => r[0]?.count ?? -1);
    results.push(`users.count=${r}`);
  } catch (e: any) {
    results.push(`users.ERR: ${e.message}`);
  }

  try {
    const r = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .then((r) => r[0]?.count ?? -1);
    results.push(`subs.active=${r}`);
  } catch (e: any) {
    results.push(`subs.active.ERR: ${e.message}`);
  }

  try {
    const r = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "expired"))
      .then((r) => r[0]?.count ?? -1);
    results.push(`subs.expired=${r}`);
  } catch (e: any) {
    results.push(`subs.expired.ERR: ${e.message}`);
  }

  try {
    const r = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(
        and(eq(invoices.status, "paid"), sql`${invoices.paidAt} > now() - interval '24 hours'`),
      )
      .then((r) => r[0]?.count ?? -1);
    results.push(`invoices.paid24h=${r}`);
  } catch (e: any) {
    results.push(`invoices.paid24h.ERR: ${e.message}`);
  }

  try {
    const r = await db
      .select({
        total: sql<string>`coalesce(sum(${invoices.amountUsdt}), 0)`,
      })
      .from(invoices)
      .where(eq(invoices.status, "paid"))
      .then((r) => r[0]?.total ?? "0");
    results.push(`invoices.totalRevenue=${r}`);
  } catch (e: any) {
    results.push(`invoices.totalRevenue.ERR: ${e.message}`);
  }

  try {
    const r = await db
      .select({
        total: sql<string>`coalesce(sum(${commissionLedger.amountUsdt}), 0)`,
      })
      .from(commissionLedger)
      .where(eq(commissionLedger.status, "accrued"))
      .then((r) => r[0]?.total ?? "0");
    results.push(`commLedger.accrued=${r}`);
  } catch (e: any) {
    results.push(`commLedger.accrued.ERR: ${e.message}`);
  }

  try {
    const r = await db
      .select({
        tgUsername: users.tgUsername,
        tgUserId: users.tgUserId,
        createdAt: users.createdAt,
        role: users.role,
        refCode: users.refCode,
        parentRefCode: users.parentRefCode,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(5);
    results.push(`users.latest5=${JSON.stringify(r.map(u => ({tg: u.tgUsername, role: u.role, ref: u.refCode, parent: u.parentRefCode})))}`);
  } catch (e: any) {
    results.push(`users.latest5.ERR: ${e.message}`);
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
