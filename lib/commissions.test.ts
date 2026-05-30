import { describe, it, expect } from "vitest";
import { pickTier, computeCommissionAmount } from "./commissions";

describe("pickTier", () => {
  const tiers = [
    { min: 0, bps: 2000 },
    { min: 10, bps: 3000 },
  ];

  it("returns first tier for count below second tier threshold", () => {
    expect(pickTier(tiers, 0)).toEqual({ min: 0, bps: 2000 });
    expect(pickTier(tiers, 9)).toEqual({ min: 0, bps: 2000 });
  });

  it("returns second tier for count at threshold", () => {
    expect(pickTier(tiers, 10)).toEqual({ min: 10, bps: 3000 });
  });

  it("returns highest matching tier for count well above", () => {
    expect(pickTier(tiers, 50)).toEqual({ min: 10, bps: 3000 });
  });

  it("works with single-tier config", () => {
    const single = [{ min: 0, bps: 1500 }];
    expect(pickTier(single, 999)).toEqual({ min: 0, bps: 1500 });
  });

  it("returns the tier with highest min when multiple tiers match", () => {
    const multi = [
      { min: 0, bps: 1000 },
      { min: 5, bps: 2000 },
      { min: 10, bps: 3000 },
    ];
    expect(pickTier(multi, 7)).toEqual({ min: 5, bps: 2000 });
    expect(pickTier(multi, 10)).toEqual({ min: 10, bps: 3000 });
    expect(pickTier(multi, 100)).toEqual({ min: 10, bps: 3000 });
  });
});

describe("computeCommissionAmount", () => {
  it("computes 20% commission on 9.99 USDT", () => {
    const amount = computeCommissionAmount("9.990000", 2000);
    expect(amount).toBe("1.998000");
  });

  it("computes 10% cascade on L1 commission", () => {
    const l1Amount = computeCommissionAmount("9.990000", 2000); // = 1.998000
    const l2Amount = computeCommissionAmount(l1Amount, 1000); // 10% of L1
    expect(l2Amount).toBe("0.199800");
  });

  it("handles zero bps", () => {
    expect(computeCommissionAmount("100.000000", 0)).toBe("0.000000");
  });

  it("handles 100% (10000 bps)", () => {
    expect(computeCommissionAmount("50.000000", 10000)).toBe("50.000000");
  });
});
