import { describe, it, expect } from "vitest";

describe("grantChannelAccess", () => {
  it("is callable (function exists)", async () => {
    const { grantChannelAccess } = await import("./grant");
    expect(typeof grantChannelAccess).toBe("function");
  });
});

describe("formatGrantMessage", () => {
  it("formats invite link message correctly", async () => {
    const { formatGrantMessage } = await import("./grant");
    const inviteLink = "https://t.me/+AbcDefGhIjKlMnOp";
    const planName = "1 month";
    const message = formatGrantMessage({ inviteLink, planName });
    expect(message).toContain(inviteLink);
    expect(message).toContain(planName);
    expect(message).toContain("Here's your invite link");
  });
});
