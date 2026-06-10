/**
 * TEMP: set payout address for admin user.
 */
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  // Set cold wallet as payout address for admin
  const result = await db
    .update(users)
    .set({
      payoutAddress: "TBaKukSZYVKBLBW25oskU8pd2v7yiFb3vW",
      payoutAddressChangedAt: new Date(),
    })
    .where(eq(users.tgUserId, BigInt(607645943)));
  
  return Response.json({ ok: true, updated: result.rowCount });
}
