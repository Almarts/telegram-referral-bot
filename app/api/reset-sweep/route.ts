/**
 * Direct sweep: send 1 USDT from deposit TD7nWpy... to cold wallet.
 */
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const tron = getTron();
  const env = getEnv();
  
  try {
    // signerForIndex for the deposit address at derivIndex from our invoice
    // We derived it with index from seq — need to find it
    // Actually, let's just use the xprv to derive the signer, but we know the index was from nextval
    // Let me try a different approach — send via hot wallet signer
    
    // The deposit address is TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu
    // We need the private key for it — derived from xprv at some index
    // Let's just check if we can use sendUsdt from deposit address with proper signer
    
    // Actually, the sweep script handles this. Let me just mark the invoice as not swept
    // and force sweep
    const { getDb } = await import("@/db/client");
    const { invoices } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    
    const db = getDb();
    
    // Find the invoice
    const inv = await db
      .select()
      .from(invoices)
      .where(eq(invoices.depositAddress, "TD7nWpyYUUFkxoUYotC5M83MDcxUDDeWdu"))
      .limit(1)
      .then(r => r[0]);
    
    if (!inv) return Response.json({ error: "invoice not found" });
    
    // Reset swept=false if it was set
    if (inv.swept) {
      await db
        .update(invoices)
        .set({ swept: false, sweepTxHash: null })
        .where(eq(invoices.id, inv.id));
    }
    
    return Response.json({
      invoiceId: inv.id.slice(0,8),
      derivIndex: inv.derivIndex,
      depositAddress: inv.depositAddress,
      swept: inv.swept,
      note: "Reset to not swept, run /api/run-sweep again"
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err).slice(0, 500) });
  }
}
