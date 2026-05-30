import { getDb } from "@/db/client";
import {
  users,
  invoices,
  commissionLedger,
  commissionConfig,
  payoutBatches,
} from "@/db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { pickTier } from "@/lib/commissions";
import { add } from "@/lib/money";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TierConfig {
  min: number;
  bps: number;
}

export interface ReferralStats {
  l1Count: number;
  l1LifetimePaid: number;
  l1TierBps: number;
  nextTier: TierConfig | null;
  l2Count: number;
  l2LifetimePaid: number;
}

export interface EarningsSummary {
  paidUsdt: string;
  payableUsdt: string;
  accruedUsdt: string;
  lifetimeUsdt: string;
  byLevel30d: { l1: string; l2: string };
  recentPayouts: {
    amountUsdt: string;
    txHash: string | null;
    broadcastAt: Date | null;
  }[];
}

// ── Pure builders ──────────────────────────────────────────────────────────

export function buildReferralStats(params: {
  l1Users: { id: string }[];
  l1PaidCounts: Map<string, number>;
  l2Users: { id: string }[];
  l2PaidCounts: Map<string, number>;
  tiers: TierConfig[];
}): ReferralStats {
  const l1Count = params.l1Users.length;
  const l2Count = params.l2Users.length;

  let l1LifetimePaid = 0;
  for (const u of params.l1Users) {
    l1LifetimePaid += params.l1PaidCounts.get(u.id) ?? 0;
  }

  let l2LifetimePaid = 0;
  for (const u of params.l2Users) {
    l2LifetimePaid += params.l2PaidCounts.get(u.id) ?? 0;
  }

  const currentTier = pickTier(params.tiers, l1LifetimePaid);
  const l1TierBps = currentTier.bps;

  let nextTier: TierConfig | null = null;
  for (const t of params.tiers) {
    if (t.min > l1LifetimePaid) {
      if (!nextTier || t.min < nextTier.min) {
        nextTier = t;
      }
    }
  }

  return { l1Count, l1LifetimePaid, l1TierBps, nextTier, l2Count, l2LifetimePaid };
}

export function buildEarningsSummary(params: {
  ledgerRows: {
    level: number;
    status: string;
    amountUsdt: string;
    createdAt: Date;
  }[];
  recentPayouts: {
    amountUsdt: string;
    txHash: string | null;
    broadcastAt: Date | null;
  }[];
}): EarningsSummary {
  let paid = "0.000000";
  let payable = "0.000000";
  let accrued = "0.000000";
  let lifetime = "0.000000";
  let l1_30d = "0.000000";
  let l2_30d = "0.000000";

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const row of params.ledgerRows) {
    const a = row.amountUsdt;

    if (row.status === "paid") {
      paid = add(paid, a);
      lifetime = add(lifetime, a);
    } else if (row.status === "payable") {
      payable = add(payable, a);
      lifetime = add(lifetime, a);
    } else {
      accrued = add(accrued, a);
    }

    if (row.createdAt >= thirtyDaysAgo) {
      if (row.level === 1) l1_30d = add(l1_30d, a);
      if (row.level === 2) l2_30d = add(l2_30d, a);
    }
  }

  return {
    paidUsdt: paid,
    payableUsdt: payable,
    accruedUsdt: accrued,
    lifetimeUsdt: lifetime,
    byLevel30d: { l1: l1_30d, l2: l2_30d },
    recentPayouts: params.recentPayouts,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function paidCountsForUsers(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      userId: invoices.userId,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(and(eq(invoices.status, "paid"), inArray(invoices.userId, userIds)))
    .groupBy(invoices.userId);

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.userId, row.count);
  }
  return map;
}

async function usersByParentCodes(
  parentCodes: string[],
): Promise<{ id: string; refCode: string | null }[]> {
  if (parentCodes.length === 0) return [];

  const db = getDb();
  // SQL: WHERE parent_ref_code = ANY($1)
  const rows = await db
    .select({ id: users.id, refCode: users.refCode })
    .from(users)
    .where(
      sql`${users.parentRefCode} = ANY(ARRAY[${sql.join(parentCodes.map((c) => sql`${c}`), sql`, `)}])`,
    );
  return rows;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const db = getDb();

  const user = await db
    .select({ refCode: users.refCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user?.refCode) {
    return { l1Count: 0, l1LifetimePaid: 0, l1TierBps: 0, nextTier: null, l2Count: 0, l2LifetimePaid: 0 };
  }

  // L1: users whose parent_ref_code = my ref_code
  const l1Users = await usersByParentCodes([user.refCode]);
  const l1Ids = l1Users.map((u) => u.id);
  const l1PaidCounts = await paidCountsForUsers(l1Ids);

  // L2: users whose parent_ref_code is in L1 ref_codes
  const l1RefCodes = l1Users.map((u) => u.refCode).filter((c): c is string => c !== null);
  const l2Users = await usersByParentCodes(l1RefCodes);
  const l2Ids = l2Users.map((u) => u.id);
  const l2PaidCounts = await paidCountsForUsers(l2Ids);

  // Tier config
  const cfg = await db
    .select({ l1Tiers: commissionConfig.l1Tiers })
    .from(commissionConfig)
    .limit(1)
    .then((r) => r[0] ?? null);
  const tiers = (cfg?.l1Tiers as TierConfig[]) ?? [];

  return buildReferralStats({ l1Users, l1PaidCounts, l2Users, l2PaidCounts, tiers });
}

export async function getEarningsSummary(userId: string): Promise<EarningsSummary> {
  const db = getDb();

  const ledgerRows = await db
    .select({
      level: commissionLedger.level,
      status: commissionLedger.status,
      amountUsdt: commissionLedger.amountUsdt,
      createdAt: commissionLedger.unlockAt,
    })
    .from(commissionLedger)
    .where(eq(commissionLedger.beneficiaryId, userId));

  const payouts = await db
    .select({
      amountUsdt: payoutBatches.amountUsdt,
      txHash: payoutBatches.txHash,
      broadcastAt: payoutBatches.broadcastAt,
    })
    .from(payoutBatches)
    .where(eq(payoutBatches.beneficiaryId, userId))
    .orderBy(desc(payoutBatches.broadcastAt))
    .limit(5);

  return buildEarningsSummary({
    ledgerRows: ledgerRows.map((r) => ({
      level: r.level,
      status: r.status,
      amountUsdt: r.amountUsdt,
      createdAt: r.createdAt,
    })),
    recentPayouts: payouts,
  });
}
