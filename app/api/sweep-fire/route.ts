import { processSweeps } from "@/lib/sweep";
import { getDb } from "@/db/client";
import { invoices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getTron } from "@/lib/tron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const tron = getTron();

  // Manually check the invoice balance
  const inv = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, "6eb4de20-f078-4cd8-8a01-090c59e0f29c"))
    .limit(1)
    .then(r => r[0]);

  let manualBalance = "not checked";
  if (inv?.depositAddress) {
    manualBalance = await tron.usdtBalance(inv.depositAddress);
  }

  const swept = await processSweeps();

  return Response.json({
    manualBalance,
    depositAddress: inv?.depositAddress,
    processSweepsResult: swept,
    ts: new Date().toISOString(),
  });
}
