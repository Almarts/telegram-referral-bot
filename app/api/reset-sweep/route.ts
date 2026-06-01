import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const db = getDb();
  
  await db
    .update(invoices)
    .set({ swept: false, sweepTxHash: null })
    .where(and(eq(invoices.id, "6eb4de20-f078-4cd8-8a01-090c59e0f29c"), eq(invoices.swept, true)));

  const check = await db
    .select({ id: invoices.id, swept: invoices.swept, sweepTxHash: invoices.sweepTxHash })
    .from(invoices)
    .where(eq(invoices.id, "6eb4de20-f078-4cd8-8a01-090c59e0f29c"))
    .limit(1);

  return new Response(
    JSON.stringify({ reset: true, invoice: check[0] ?? null }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
