/**
 * TEMP: check payout status.
 */
import { getDb } from "@/db/client";
import { payoutBatches, commissionLedger } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  
  const batches = await db
    .select()
    .from(payoutBatches)
    .orderBy(payoutBatches.id)
    .limit(10);
  
  const ledger = await db
    .select()
    .from(commissionLedger)
    .orderBy(commissionLedger.id)
    .limit(10);

  return Response.json({ batches, ledger });
}
