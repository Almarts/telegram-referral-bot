import { describe, it, expect } from "vitest";
import { onboardLogic } from "./onboarding";

describe("onboardLogic", () => {
  it("returns 'created' and sets parent for new user with valid referral", () => {
    const result = onboardLogic({
      existingUser: null,
      startPayload: "ABC123",
      refByPayload: { id: "ref-uuid", refCode: "ABC123" },
      ownRefCode: null,
    });
    expect(result.action).toBe("created");
    expect(result.parentRefCode).toBe("ABC123");
    expect(result.refCode).toBeDefined();
    expect(result.refCode).toHaveLength(6);
  });

  it("returns 'existing' and ignores parent code when it is the user's own code (self-referral)", () => {
    const result = onboardLogic({
      existingUser: {
        id: "my-uuid",
        tgUserId: 123n,
        refCode: "MYCODE",
        parentRefCode: null,
      },
      startPayload: "MYCODE",
      refByPayload: { id: "my-uuid", refCode: "MYCODE" },
      ownRefCode: "MYCODE",
    });
    expect(result.action).toBe("existing");
    expect(result.parentRefCode).toBeNull();
    expect(result.refCode).toBe("MYCODE");
  });

  it("returns 'created' with null parent when startPayload has no matching user", () => {
    const result = onboardLogic({
      existingUser: null,
      startPayload: "UNKNOWN",
      refByPayload: null,
      ownRefCode: null,
    });
    expect(result.action).toBe("created");
    expect(result.parentRefCode).toBeNull();
    expect(result.refCode).toBeDefined();
    expect(result.refCode).toHaveLength(6);
  });

  it("returns 'existing' and locks parent for returning user (no override)", () => {
    const result = onboardLogic({
      existingUser: {
        id: "existing-uuid",
        tgUserId: 123n,
        refCode: "EXIST",
        parentRefCode: "LOCKED",
      },
      startPayload: "NEWCODE",
      refByPayload: { id: "other-uuid", refCode: "NEWCODE" },
      ownRefCode: "EXIST",
    });
    expect(result.action).toBe("existing");
    expect(result.parentRefCode).toBe("LOCKED"); // unchanged
    expect(result.refCode).toBe("EXIST"); // unchanged
  });

  it("generates ref code for existing user who lacks one (catch-up)", () => {
    const result = onboardLogic({
      existingUser: {
        id: "catchup-uuid",
        tgUserId: 456n,
        refCode: null,
        parentRefCode: null,
      },
      startPayload: undefined,
      refByPayload: null,
      ownRefCode: null,
    });
    expect(result.action).toBe("existing");
    expect(result.refCode).toBeDefined();
    expect(result.refCode).toHaveLength(6);
    expect(result.parentRefCode).toBeNull();
  });

  it("returns no-op when user exists and has ref_code and parent already set", () => {
    const result = onboardLogic({
      existingUser: {
        id: "done-uuid",
        tgUserId: 789n,
        refCode: "DONE01",
        parentRefCode: "FIXED",
      },
      startPayload: undefined,
      refByPayload: null,
      ownRefCode: "DONE01",
    });
    expect(result.action).toBe("existing");
    expect(result.refCode).toBe("DONE01");
    expect(result.parentRefCode).toBe("FIXED");
  });
});
