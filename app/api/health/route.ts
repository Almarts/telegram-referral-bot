import { getDb } from "@/db/client";
import { invoices, opsKillSwitch } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();

  try {
    // Pending invoice count
    const pending = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(eq(invoices.status, "pending"))
      .then((r) => r[0]?.count ?? 0);

    // Kill switch status
    const ks = await db
      .select()
      .from(opsKillSwitch)
      .limit(1)
      .then((r) => r[0] ?? null);

    return Response.json({
      status: "ok",
      pendingInvoices: pending,
      killSwitch: {
        buyDisabled: ks?.buyDisabled ?? false,
        payoutDisabled: ks?.payoutDisabled ?? false,
      },
    });
  } catch {
    return Response.json(
      { status: "error", message: "Service unavailable" },
      { status: 503 },
    );
  }
}
