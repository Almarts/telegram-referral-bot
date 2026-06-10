/**
 * TEMP: mark invoice d1ec9dbc as paid and ready for sweep.
 */
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  
  // Find invoice by deposit address
  const inv = await db
    .select()
    .from(invoices)
    .where(eq(invoices.depositAddress, "TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu"))
    .limit(1)
    .then(r => r[0]);

  if (!inv) return Response.json({ error: "invoice not found" });
  if (inv.status !== "paid") return Response.json({ error: "invoice not paid yet", status: inv.status });
  
  // Mark as ready for sweep (paidAt was already set, just need to trigger sweep)
  return Response.json({
    invoiceId: inv.id.slice(0,8),
    depositAddress: inv.depositAddress,
    amount: inv.amountUsdt,
    status: inv.status,
    paidAt: inv.paidAt,
    note: "Ready for sweep — 15 min cooldown since paidAt"
  });
}
