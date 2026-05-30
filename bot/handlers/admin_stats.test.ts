import { describe, it, expect } from "vitest";

describe("handleAdminStats", () => {
  it("is callable (function exists)", async () => {
    const { handleAdminStats } = await import("./admin_stats");
    expect(typeof handleAdminStats).toBe("function");
  });
});
