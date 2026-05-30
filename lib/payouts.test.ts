import { describe, it, expect } from "vitest";
import { add, gte } from "@/lib/money";

describe("payout aggregation logic", () => {
  it("aggregates payable amounts correctly", () => {
    const rows = [
      { beneficiaryId: "u1", amountUsdt: "10.000000" },
      { beneficiaryId: "u1", amountUsdt: "15.000000" },
      { beneficiaryId: "u2", amountUsdt: "5.000000" },
    ];
    const byId = new Map<string, string>();
    for (const r of rows) {
      byId.set(r.beneficiaryId, add(byId.get(r.beneficiaryId) ?? "0.000000", r.amountUsdt));
    }
    expect(byId.get("u1")).toBe("25.000000");
    expect(byId.get("u2")).toBe("5.000000");
  });

  it("filters below minimum payout threshold", () => {
    const minPayout = "50.000000";
    const totals = new Map([["u1", "25.000000"], ["u2", "100.000000"]]);
    const qualifying = [...totals.entries()].filter(([, amt]) => gte(amt, minPayout));
    expect(qualifying).toHaveLength(1);
    expect(qualifying[0][0]).toBe("u2");
  });

  it("skips beneficiaries with no payout address", () => {
    const beneficiaries = [
      { id: "u1", payoutAddress: null, payoutAddressChangedAt: null, total: "100.000000" },
      { id: "u2", payoutAddress: "TXxx", payoutAddressChangedAt: new Date(Date.now() - 25 * 3600 * 1000), total: "50.000000" },
    ];
    const eligible = beneficiaries.filter(
      (b) => b.payoutAddress &&
        (!b.payoutAddressChangedAt || Date.now() - b.payoutAddressChangedAt.getTime() > 24 * 3600 * 1000)
    );
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe("u2");
  });
});
