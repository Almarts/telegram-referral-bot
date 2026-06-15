import { getDb } from "@/db/client";
import { invoices, opsKillSwitch } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();

  try {
    // First test basic connection
    const testResult = await db.execute(sql`SELECT 1 as ok`);
    console.log("HEALTH_DB_TEST_OK", JSON.stringify(testResult));

    const pending = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(eq(invoices.status, "open"))
      .then((r) => r[0]?.count ?? 0);

    const ks = await db
      .select()
      .from(opsKillSwitch)
      .limit(1)
      .then((r) => r[0] ?? null);

    return Response.json({
      status: "ok",
      dbTest: testResult,
      pendingInvoices: pending,
      killSwitch: {
        buyDisabled: ks?.buyDisabled ?? false,
        payoutDisabled: ks?.payoutDisabled ?? false,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
    console.error("HEALTH_ERR", msg);
    // Try to get more detail from the cause
    let detail = msg;
    if (err instanceof Error && (err as any).cause) {
      detail += '\nCAUSE: ' + JSON.stringify((err as any).cause);
    }
    return Response.json(
      { status: "error", message: detail },
      { status: 503 },
    );
  }
}
// redeploy trigger 15 Jun 2026 20:01:06
