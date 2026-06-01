import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and, lt, sql, asc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();

  const toSweep = await db
    .select({
      id: invoices.id,
      depositAddress: invoices.depositAddress,
      derivIndex: invoices.derivIndex,
      amountUsdt: invoices.amountUsdt,
      status: invoices.status,
      swept: invoices.swept,
      paidAt: invoices.paidAt,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, "paid"),
        eq(invoices.swept, false),
        lt(invoices.paidAt, sql`now() - interval '15 minutes'`),
      ),
    )
    .orderBy(asc(invoices.paidAt))
    .limit(100);

  // Also show the debug invoice specifically
  const invoice6eb = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, "6eb4de20-f078-4cd8-8a01-090c59e0f29c"))
    .limit(1);

  const invoice6ebPaid = toSweep.find(i => i.id === "6eb4de20-f078-4cd8-8a01-090c59e0f29c");

  return Response.json({
    toSweepCount: toSweep.length,
    toSweep,
    invoice6eb,
    invoiceInToSweep: !!invoice6ebPaid,
    sql: `SELECT ... WHERE status='paid' AND swept=false AND paidAt < now() - interval '15 minutes'`,
  });
}
