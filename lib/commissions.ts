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
 * Delegates to fromBps from @/lib/money for consistent 6dp math.
 */
export function computeCommissionAmount(basis: string, bps: number): string {
  return fromBps(basis, bps);
}

/**
 * Accrue referral commissions for a paid invoice.
 *
 * Idempotent via UNIQUE constraint on (invoice_id, beneficiary_id, level).
 * Called AFTER settlement (not within the settlement DB write).
 */
export async function accrueCommissions(invoiceId: string): Promise<void> {
  const db = getDb();

  // 1. Fetch invoice (any status; idempotent by UNIQUE anyway)
  const invoice = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!invoice || invoice.status !== "paid") return;

  // 2. Fetch buyer's parent_ref_code
  const buyer = await db
    .select({ id: users.id, parentRefCode: users.parentRefCode })
    .from(users)
    .where(eq(users.id, invoice.userId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!buyer?.parentRefCode) return; // no referral chain

  // 3. Find L1 (the referrer whose ref_code matches buyer's parent_ref_code)
  const l1 = await db
    .select({
      id: users.id,
      refCode: users.refCode,
      parentRefCode: users.parentRefCode,
    })
    .from(users)
    .where(eq(users.refCode, buyer.parentRefCode))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!l1) return;

  // 4. Load commission config
  const config = await db
    .select()
    .from(commissionConfig)
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!config) return;

  // 5. Compute L1's lifetime paid invoice count (excluding this invoice)
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

  // 6. Compute L1 commission
  const l1Tier = pickTier(config.l1Tiers as TierConfig[], l1Count);
  const l1Amount = computeCommissionAmount(invoice.amountUsdt, l1Tier.bps);
  const unlockAt =
    config.payoutMode === "instant"
      ? (invoice.paidAt ?? new Date())
      : new Date(
          (invoice.paidAt ?? new Date()).getTime() +
            config.deferDays * 24 * 60 * 60 * 1000,
        );

  // Insert L1 row. A UNIQUE violation means it's already accrued, which implies
  // L2 was too — so we can stop here (idempotent replay).
  const l1Inserted = await insertLedgerIdempotent({
    invoiceId: invoice.id,
    beneficiaryId: l1.id,
    level: 1,
    basisUsdt: invoice.amountUsdt,
    rateBps: l1Tier.bps,
    amountUsdt: l1Amount,
    unlockAt,
    status: "accrued",
  });
  if (!l1Inserted) return;

  // 7. L2 cascade
  if (l1.parentRefCode) {
    const l2 = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.refCode, l1.parentRefCode))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (l2) {
      const l2Amount = computeCommissionAmount(l1Amount, config.l2Bps);

      await insertLedgerIdempotent({
        invoiceId: invoice.id,
        beneficiaryId: l2.id,
        level: 2,
        basisUsdt: l1Amount,
        rateBps: config.l2Bps,
        amountUsdt: l2Amount,
        unlockAt,
        status: "accrued",
      });
    }
  }
}
