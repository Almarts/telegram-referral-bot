import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFakeTron } from "@/lib/tron/fake";
import { __setTronForTesting, __resetTronForTesting } from "@/lib/tron";

// NOTE: No vi.mock — DB calls are avoided in validation tests because the
// validation check (empty userId) throws before getDb() is ever reached.
// Full DB integration is verified in Phase K smoke tests.

describe("getActivePlans", () => {
  it("is exported as a function", async () => {
    const { getActivePlans } = await import("./invoices");
    expect(typeof getActivePlans).toBe("function");
  });
});

describe("createInvoice", () => {
  beforeEach(() => {
    __setTronForTesting(createFakeTron());
  });

  afterEach(() => {
    __resetTronForTesting();
  });

  it("is exported as a function", async () => {
    const { createInvoice } = await import("./invoices");
    expect(typeof createInvoice).toBe("function");
  });

  it("throws on empty userId — validation before DB call", async () => {
    const { createInvoice } = await import("./invoices");
    await expect(createInvoice({ userId: "", planId: 1 })).rejects.toThrow(/userId/i);
  });
});
