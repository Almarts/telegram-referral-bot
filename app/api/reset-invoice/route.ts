import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  
  // Reset the stuck invoice
  const result = await db
    .update(invoices)
    .set({ swept: false, sweepTxHash: null })
    .where(eq(invoices.id, "6eb4de20-f078-4cd8-8a01-090c59e0f29c"))
    .returning({ id: invoices.id, swept: invoices.swept, sweepTxHash: invoices.sweepTxHash });
  
  return Response.json({ reset: result });
}
