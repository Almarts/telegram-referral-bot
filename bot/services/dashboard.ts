import { getDb } from "@/db/client";
import {
  users,
  invoices,
  commissionLedger,
  commissionConfig,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

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
  accruedUsdt: string;
  totalUsdt: string;
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

  let currentTier = params.tiers[0];
  for (const tier of params.tiers) {
    if (l1LifetimePaid >= tier.min) currentTier = tier;
  }
  const l1TierBps = currentTier?.bps ?? 0;

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
  ledgerRows: { amountUsdt: string }[];
}): EarningsSummary {
  let total = "0.000000";
  for (const row of params.ledgerRows) {
    const [i, f = ""] = total.split(".");
    const ri = row.amountUsdt.split(".")[0] ?? "0";
    const rf = row.amountUsdt.split(".")[1] ?? "000000";
    const sum = BigInt(i + f.padEnd(6, "0").slice(0, 6)) +
                BigInt(ri + rf.padEnd(6, "0").slice(0, 6));
    const intPart = sum / 1_000_000n;
    const fracPart = sum % 1_000_000n;
    total = `${intPart}.${String(fracPart).padStart(6, "0")}`;
  }
  return {
    accruedUsdt: total,
    totalUsdt: total,
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
    .where(and(eq(invoices.status, "paid"), sql`${invoices.userId} = ANY(ARRAY[${sql.join(userIds.map((c) => sql`${c}`), sql`, `)}])`))
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

  const l1Users = await usersByParentCodes([user.refCode]);
  const l1Ids = l1Users.map((u) => u.id);
  const l1PaidCounts = await paidCountsForUsers(l1Ids);

  const l1RefCodes = l1Users.map((u) => u.refCode).filter((c): c is string => c !== null);
  const l2Users = await usersByParentCodes(l1RefCodes);
  const l2Ids = l2Users.map((u) => u.id);
  const l2PaidCounts = await paidCountsForUsers(l2Ids);

  const cfg = await db
    .select({ l1Tiers: commissionConfig.l1Tiers })
    .from(commissionConfig)
    .limit(1)
    .then((r) => r[0] ?? null);
  const tiers = (cfg?.l1Tiers as TierConfig[]) ?? [];

  const l1User = await db
    .select({ role: users.role, vipBps: users.vipBps })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (l1User?.role === "creator" && l1User?.vipBps != null) {
    const tier: TierConfig = { min: 0, bps: l1User.vipBps };
    return buildReferralStats({
      l1Users, l1PaidCounts, l2Users, l2PaidCounts, tiers: [tier],
    });
  }

  return buildReferralStats({ l1Users, l1PaidCounts, l2Users, l2PaidCounts, tiers });
}

export async function getEarningsSummary(userId: string): Promise<EarningsSummary> {
  const db = getDb();

  const ledgerRows = await db
    .select({ amountUsdt: commissionLedger.amountUsdt })
    .from(commissionLedger)
    .where(eq(commissionLedger.beneficiaryId, userId));

  return buildEarningsSummary({ ledgerRows });
}
