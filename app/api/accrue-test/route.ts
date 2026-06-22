import { getDb, getPool } from "@/db/client";
import { invoices, users, commissionLedger, subscriptions, commissionConfig } from "@/db/schema";
import { eq, sql, and, gt } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pool = getPool();
  const logs: string[] = [];
  const log = (m: string) => { console.log("ACCRUE_DEBUG:", m); logs.push(m); };

  try {
    // Try direct INSERT via raw pool.query
    log("Attempting raw pool.query...");
    try {
      const result = await pool.query(`
        INSERT INTO commission_ledger (invoice_id, beneficiary_id, level, basis_usdt, rate_bps, amount_usdt, status)
        VALUES (
          'cf3a3927-9733-46e2-a49c-741935bc66a6',
          '3dc898a6-6e7b-4992-b8bb-4bbc0308dae9',
          1, '10.000000', 5000, '5.000000', 'accrued'
        )
        ON CONFLICT (invoice_id, beneficiary_id, level) DO NOTHING
        RETURNING id
      `);
      log(`RAW SQL result: rows=${result.rowCount}`);
    } catch (e: any) {
      log(`RAW SQL FAILED: ${e.name}: ${e.message}`);
      log(`Code: ${e.code} Detail: ${e.detail || "none"} Hint: ${e.hint || "none"}`);
      log(`Where: ${e.where || "none"}`);
    }

    // Check if commission exists now
    const existing = await pool.query(
      "SELECT count(*)::int as cnt FROM commission_ledger WHERE invoice_id = $1",
      ["cf3a3927-9733-46e2-a49c-741935bc66a6"]
    );
    log(`Commissions now: ${existing.rows[0]?.cnt ?? 0}`);

  } catch (e: any) {
    log(`FATAL: ${e.name}: ${e.message}`);
  }

  return Response.json({ status: "ok", logs });
}
