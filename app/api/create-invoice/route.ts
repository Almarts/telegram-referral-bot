/**
 * TEMP: create invoice for admin user (tg 607645943) with plan 1 (1 USDT).
 * DELETE AFTER USE.
 */
import { getDb } from "@/db/client";
import { users, invoices } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getTron } from "@/lib/tron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const tron = getTron();
  
  const admin = await db
    .select()
    .from(users)
    .where(eq(users.tgUserId, BigInt(607645943)))
    .limit(1)
    .then(r => r[0]);
  if (!admin) return Response.json({ error: "admin not found" });

  const [seq] = await db
    .select({ n: sql<number>`nextval('deriv_index_seq')` })
    .from(sql`(SELECT 1)`);
  const idx = Number(seq.n);
  const { address } = tron.deriveDepositAddress(idx);

  const [inv] = await db
    .insert(invoices)
    .values({
      userId: admin.id,
      planId: 1,
      depositAddress: address,
      derivIndex: idx,
      amountUsdt: "1.000000",
      status: "open",
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();

  return Response.json({
    ok: true,
    depositAddress: address,
    invoiceId: inv.id.slice(0, 8),
    amount: "1.000000 USDT",
    note: "Send exactly 1 USDT (TRC20) to this address",
  });
}
