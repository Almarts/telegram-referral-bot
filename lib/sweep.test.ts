import { describe, it, expect } from "vitest";

describe("sweepInvoice", () => {
  it("marks swept when balance is zero (no tx fired)", async () => {
    const { sweepInvoice } = await import("./sweep");

    const result = sweepInvoice({
      address: "T001",
      derivIndex: 0,
      invoiceId: "inv-1",
      coldAddress: "COLD",
      trxForTransferSun: 30_000_000n,
      usdtBalance: "0.000000",
      trxBalanceSun: 0n,
    });

    expect(result.swept).toBe(true);
    expect(result.txHash).toBeNull();
    expect(result.needsTrxTopUp).toBe(false);
  });

  it("returns needsTrxTopUp when USDT exists but TRX is insufficient", async () => {
    const { sweepInvoice } = await import("./sweep");

    const result = sweepInvoice({
      address: "T001",
      derivIndex: 0,
      invoiceId: "inv-1",
      coldAddress: "COLD",
      trxForTransferSun: 30_000_000n,
      usdtBalance: "10.000000",
      trxBalanceSun: 0n,
    });

    expect(result.swept).toBe(false);
    expect(result.needsTrxTopUp).toBe(true);
  });

  it("signals ready to sweep when both USDT and TRX are sufficient", async () => {
    const { sweepInvoice } = await import("./sweep");

    const result = sweepInvoice({
      address: "T001",
      derivIndex: 0,
      invoiceId: "inv-1",
      coldAddress: "COLD",
      trxForTransferSun: 30_000_000n,
      usdtBalance: "10.000000",
      trxBalanceSun: 50_000_000n,
    });

    expect(result.swept).toBe(false);
    expect(result.needsTrxTopUp).toBe(false);
  });
});
