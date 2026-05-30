import { describe, it, expect } from "vitest";
import { buildReferralStats } from "./dashboard";
import type { TierConfig } from "./dashboard";

const TWO_TIERS: TierConfig[] = [
  { min: 0, bps: 2000 },
  { min: 10, bps: 3000 },
];

describe("buildReferralStats", () => {
  it("returns zeros when user has no referrals", () => {
    const stats = buildReferralStats({
      l1Users: [],
      l1PaidCounts: new Map(),
      l2Users: [],
      l2PaidCounts: new Map(),
      tiers: TWO_TIERS,
    });

    expect(stats.l1Count).toBe(0);
    expect(stats.l1LifetimePaid).toBe(0);
    expect(stats.l2Count).toBe(0);
    expect(stats.l2LifetimePaid).toBe(0);
    expect(stats.l1TierBps).toBe(2000);
    expect(stats.nextTier).toEqual({ min: 10, bps: 3000 });
  });

  it("counts L1 referrals and their paid invoices", () => {
    // A (user) referred B, B has 3 paid invoices
    const stats = buildReferralStats({
      l1Users: [{ id: "user-b" }],
      l1PaidCounts: new Map([["user-b", 3]]),
      l2Users: [],
      l2PaidCounts: new Map(),
      tiers: TWO_TIERS,
    });

    expect(stats.l1Count).toBe(1);
    expect(stats.l1LifetimePaid).toBe(3);
    expect(stats.l2Count).toBe(0);
    expect(stats.l2LifetimePaid).toBe(0);
  });

  it("counts L2 referrals via L1's ref_code", () => {
    // A referred B, B referred C
    const stats = buildReferralStats({
      l1Users: [{ id: "user-b" }],
      l1PaidCounts: new Map([["user-b", 5]]),
      l2Users: [{ id: "user-c" }],
      l2PaidCounts: new Map([["user-c", 2]]),
      tiers: TWO_TIERS,
    });

    expect(stats.l1Count).toBe(1);
    expect(stats.l2Count).toBe(1);
    expect(stats.l1LifetimePaid).toBe(5);
    expect(stats.l2LifetimePaid).toBe(2);
  });

  it("upgrades tier when lifetime paid crosses threshold", () => {
    const stats = buildReferralStats({
      l1Users: [{ id: "b" }],
      l1PaidCounts: new Map([["b", 12]]),
      l2Users: [],
      l2PaidCounts: new Map(),
      tiers: TWO_TIERS,
    });

    expect(stats.l1TierBps).toBe(3000);
    expect(stats.nextTier).toBeNull(); // at max tier
  });

  it("returns null nextTier when at max tier", () => {
    const stats = buildReferralStats({
      l1Users: [],
      l1PaidCounts: new Map(),
      l2Users: [],
      l2PaidCounts: new Map(),
      tiers: [{ min: 0, bps: 1500 }],
    });

    expect(stats.l1TierBps).toBe(1500);
    expect(stats.nextTier).toBeNull();
  });

  it("aggregates paid counts across multiple L1 users", () => {
    const stats = buildReferralStats({
      l1Users: [
        { id: "b" },
        { id: "c" },
      ],
      l1PaidCounts: new Map([
        ["b", 3],
        ["c", 7],
      ]),
      l2Users: [],
      l2PaidCounts: new Map(),
      tiers: TWO_TIERS,
    });

    expect(stats.l1LifetimePaid).toBe(10);
    expect(stats.l1TierBps).toBe(3000); // exactly at threshold
  });
});
