import { getDb } from "@/db/client";
import { users, invoices, subscriptions, commissionLedger } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const out: string[] = [];
  const log = (m: string) => { out.push(m); console.log(m); };

  try {
    // Find chilli
    const user = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tgUserId, BigInt(944750077)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!user) {
      log("chillirecords not found");
      return Response.json({ status: "not_found", logs: out });
    }

    const uid = user.id;
    log(`Found user: ${uid}`);

    // Delete commission_ledger for chilli's invoices
    const c1 = await db.execute(
      sql`DELETE FROM commission_ledger WHERE invoice_id IN (SELECT id FROM invoices WHERE user_id = ${uid})`
    );
    log(`Deleted commission_ledger: ${c1.rowCount}`);

    // Delete nudges_sent for chilli's subs
    const c2 = await db.execute(
      sql`DELETE FROM nudges_sent WHERE sub_id IN (SELECT id FROM subscriptions WHERE user_id = ${uid})`
    );
    log(`Deleted nudges: ${c2.rowCount}`);

    // Delete subscriptions
    const c3 = await db.execute(
      sql`DELETE FROM subscriptions WHERE user_id = ${uid}`
    );
    log(`Deleted subscriptions: ${c3.rowCount}`);

    // Delete invoices
    const c4 = await db.execute(
      sql`DELETE FROM invoices WHERE user_id = ${uid}`
    );
    log(`Deleted invoices: ${c4.rowCount}`);

    // Delete user
    const c5 = await db.execute(
      sql`DELETE FROM users WHERE id = ${uid}`
    );
    log(`Deleted user: ${c5.rowCount}`);

    log("✅ chillirecords полностью удалён");
  } catch (e: any) {
    log(`ERROR: ${e.message}`);
    return Response.json({ status: "error", error: e.message, logs: out });
  }

  return Response.json({ status: "ok", logs: out });
}
