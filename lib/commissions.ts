import { getDb } from "@/db/client";
import {
  users,
  invoices,
  commissionLedger,
  commissionConfig,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { fromBps } from "@/lib/money";
import { isUniqueViolation } from "@/lib/db-errors";

type LedgerRow = typeof commissionLedger.$inferInsert;

/**
 * Insert a commission ledger row, treating a UNIQUE violation as a no-op.
 * Returns true if inserted, false if the row already existed (idempotent replay).
 */
async function insertLedgerIdempotent(row: LedgerRow): Promise<boolean> {
  const db = getDb();
  try {
    await db.insert(commissionLedger).values(row);
    return true;
  } catch (err: unknown) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

export interface TierConfig {
  min: number;
  bps: number;
}

/**
 * Pick the highest tier whose min <= count.
 * Tiers are assumed sorted by min ascending.
 */
export function pickTier(
  tiers: TierConfig[],
  count: number,
): TierConfig {
  let best = tiers[0];
  for (const tier of tiers) {
    if (count >= tier.min) best = tier;
  }
  return best;
}

/**
 * Compute commission amount = basis * bps / 10000.
 */
export function computeCommissionAmount(basis: string, bps: number): string {
  return fromBps(basis, bps);
}

/**
 * Accrue referral commissions for a paid invoice.
 * Idempotent via UNIQUE constraint on (invoice_id, beneficiary_id, level).
 * Commissions are simply recorded as accrued — no auto-payouts.
 */
export async function accrueCommissions(invoiceId: string): Promise<void> {
  const db = getDb();

  const invoice = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!invoice || invoice.status !== "paid") return;

  const buyer = await db
    .select({ id: users.id, parentRefCode: users.parentRefCode })
    .from(users)
    .where(eq(users.id, invoice.userId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!buyer?.parentRefCode) return;

  const l1 = await db
    .select({ id: users.id, refCode: users.refCode, parentRefCode: users.parentRefCode })
    .from(users)
    .where(eq(users.refCode, buyer.parentRefCode))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!l1) return;

  const config = await db
    .select()
    .from(commissionConfig)
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!config) return;

  const l1User = await db
    .select({ role: users.role, vipBps: users.vipBps })
    .from(users)
    .where(eq(users.id, l1.id))
    .limit(1)
    .then((r) => r[0] ?? null);
  const l1Role = l1User?.role ?? "regular";
  const vipBps = l1User?.vipBps ?? null;

  let l1Amount: string;
  let l1Bps: number;

  if (l1Role !== "creator") {
    l1Bps = 0;
    l1Amount = "0";
  } else if (vipBps !== null) {
    l1Bps = vipBps;
    l1Amount = computeCommissionAmount(invoice.amountUsdt, l1Bps);
  } else {
    const l1Count = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(users, eq(users.id, invoices.userId))
      .where(
        and(
          eq(users.parentRefCode, l1.refCode!),
          eq(invoices.status, "paid"),
          sql`${invoices.id} != ${invoiceId}`,
        ),
      )
      .then((r) => r[0]?.count ?? 0);

    const l1Tier = pickTier(config.l1Tiers as TierConfig[], l1Count);
    l1Bps = l1Tier.bps;
    l1Amount = computeCommissionAmount(invoice.amountUsdt, l1Bps);
  }

  // No unlockAt — commissions are recorded but never auto-unlocked
  const l1Inserted = await insertLedgerIdempotent({
    invoiceId: invoice.id,
    beneficiaryId: l1.id,
    level: 1,
    basisUsdt: invoice.amountUsdt,
    rateBps: l1Bps,
    amountUsdt: l1Amount,
    status: "accrued",
  });
  if (!l1Inserted) return;

  // L2 cascade
  if (l1Role === "creator" && l1.parentRefCode) {
    const l2 = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.refCode, l1.parentRefCode))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (l2) {
      // L2 gets a percentage of the FULL invoice amount, not of L1's commission
      const l2Amount = computeCommissionAmount(invoice.amountUsdt, config.l2Bps);

      await insertLedgerIdempotent({
        invoiceId: invoice.id,
        beneficiaryId: l2.id,
        level: 2,
        basisUsdt: invoice.amountUsdt,
        rateBps: config.l2Bps,
        amountUsdt: l2Amount,
        status: "accrued",
      });
    }
  }
}
