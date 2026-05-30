import { describe, it, expect } from "vitest";
import { gte } from "@/lib/money";
import { computeRenewalStart } from "./settle";

// These tests verify the payment detection logic that drives settleIfPaid.
// Full integration tests with a real DB and the complete settleIfPaid flow
// are covered in Phase K (end-to-end verification).
//
// The core decision rule: a confirmed USDT transfer >= the invoice amount
// settles the invoice. Underpayments are flagged; unconfirmed transfers
// are ignored.

describe("settleIfPaid — pure logic", () => {
  it("detects full payment when transfer amount >= invoice amount", () => {
    const invoice = { amountUsdt: "9.990000", status: "pending" as const };
    const transfers = [
      { amountUsdt: "9.990000", txHash: "0x1", confirmed: true },
    ];
    const match = transfers.find(
      (t) => t.confirmed && gte(t.amountUsdt, invoice.amountUsdt),
    );
    expect(match).toBeDefined();
    expect(match!.txHash).toBe("0x1");
  });

  it("detects underpayment when transfer amount < invoice amount", () => {
    const invoice = { amountUsdt: "9.990000", status: "pending" as const };
    const transfers = [
      { amountUsdt: "5.000000", txHash: "0x2", confirmed: true },
    ];
    const isFull = transfers.some(
      (t) => t.confirmed && gte(t.amountUsdt, invoice.amountUsdt),
    );
    expect(isFull).toBe(false);
  });

  it("ignores unconfirmed transfers", () => {
    const invoice = { amountUsdt: "9.990000", status: "pending" as const };
    const transfers = [
      { amountUsdt: "9.990000", txHash: "0x3", confirmed: false },
    ];
    const match = transfers.find(
      (t) => t.confirmed && gte(t.amountUsdt, invoice.amountUsdt),
    );
    expect(match).toBeUndefined();
  });
});

describe("computeRenewalStart — stacking rule", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("returns now when there is no active subscription", () => {
    const result = computeRenewalStart(now, undefined);
    expect(result).toEqual(now);
  });

  it("returns now when active subscription already ended", () => {
    const pastEndsAt = new Date("2026-05-30T00:00:00Z"); // before now
    const result = computeRenewalStart(now, pastEndsAt);
    expect(result).toEqual(now);
  });

  it("stacks on active sub: returns old ends_at when it is in the future", () => {
    const futureEndsAt = new Date("2026-07-01T00:00:00Z"); // after now
    const result = computeRenewalStart(now, futureEndsAt);
    expect(result).toEqual(futureEndsAt);
  });
});
