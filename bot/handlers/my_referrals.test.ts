import { describe, it, expect } from "vitest";

describe("handleMyReferrals", () => {
  it("is callable (function exists)", async () => {
    const { handleMyReferrals } = await import("./my_referrals");
    expect(typeof handleMyReferrals).toBe("function");
  });
});
