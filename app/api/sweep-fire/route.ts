import { processSweeps } from "@/lib/sweep";
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and, lt, sql, asc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();

  // Same query as processSweeps
  const toSweep = await db
    .select({
      id: invoices.id,
      depositAddress: invoices.depositAddress,
      derivIndex: invoices.derivIndex,
      amountUsdt: invoices.amountUsdt,
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

  const swept = await processSweeps();

  // Now query again to see if status changed
  const postSweep = await db
    .select({
      id: invoices.id,
      swept: invoices.swept,
      sweepTxHash: invoices.sweepTxHash,
    })
    .from(invoices)
    .where(eq(invoices.id, "6eb4de20-f078-4cd8-8a01-090c59e0f29c"))
    .limit(1);

  return Response.json({
    toSweepCount: toSweep.length,
    toSweepIds: toSweep.map(i => i.id),
    processSweepsResult: swept,
    postInvoiceStatus: postSweep,
    ts: new Date().toISOString(),
  });
}
