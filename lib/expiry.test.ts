import { describe, it, expect } from "vitest";
import { computeNudges, computeExpiries } from "./expiry";
import type { SubWithUser } from "./expiry";

function sub(overrides: Partial<SubWithUser> = {}): SubWithUser {
  return {
    subId: "sub-1",
    userId: "user-1",
    tgUserId: 100n,
    channelId: -1001234567890n,
    endsAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

describe("computeNudges", () => {
  const now = new Date("2026-05-29T00:00:00Z");

  it("returns T-72h nudge when ends_at is exactly 72h from now", () => {
    const s = sub({ endsAt: new Date("2026-06-01T00:00:00Z") }); // 72h from now
    const result = computeNudges([s], new Set(), now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ subId: "sub-1", window: "72h" });
  });

  it("returns T-24h nudge when ends_at is 24h from now", () => {
    const s = sub({ endsAt: new Date("2026-05-30T00:00:00Z") }); // 24h from now
    const result = computeNudges([s], new Set(), now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ subId: "sub-1", window: "24h" });
  });

  it("returns T-1h nudge when ends_at is 1h from now", () => {
    const s = sub({ endsAt: new Date("2026-05-29T01:00:00Z") }); // 1h from now
    const result = computeNudges([s], new Set(), now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ subId: "sub-1", window: "1h" });
  });

  it("returns no nudge when ends_at is far away", () => {
    const s = sub({ endsAt: new Date("2026-07-01T00:00:00Z") });
    const result = computeNudges([s], new Set(), now);
    expect(result).toHaveLength(0);
  });

  it("returns no nudge when ends_at is in the past", () => {
    const s = sub({ endsAt: new Date("2026-05-28T00:00:00Z") });
    const result = computeNudges([s], new Set(), now);
    expect(result).toHaveLength(0);
  });

  it("skips already-sent nudge (idempotency)", () => {
    const s = sub({ endsAt: new Date("2026-06-01T00:00:00Z") }); // 72h
    const result = computeNudges([s], new Set(["sub-1:72h"]), now);
    expect(result).toHaveLength(0);
  });

  it("returns single nudge even when sub falls in two windows", () => {
    // If a sub is at exactly T-24h but T-72h was already sent, only T-24h returns
    const s = sub({ endsAt: new Date("2026-05-30T00:00:00Z") }); // 24h
    const alreadySent = new Set(["sub-1:72h"]);
    const result = computeNudges([s], alreadySent, now);
    expect(result).toHaveLength(1);
    expect(result[0].window).toBe("24h");
  });

  it("processes multiple subs independently", () => {
    const subs = [
      sub({ subId: "sub-1", endsAt: new Date("2026-06-01T00:00:00Z") }),
      sub({ subId: "sub-2", endsAt: new Date("2026-05-30T00:00:00Z") }),
    ];
    const result = computeNudges(subs, new Set(), now);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.window).sort()).toEqual(["24h", "72h"]);
  });
});

describe("computeExpiries", () => {
  const now = new Date("2026-05-29T00:00:00Z");

  it("returns sub when ends_at is in the past", () => {
    const s = sub({ endsAt: new Date("2026-05-28T00:00:00Z") });
    const result = computeExpiries([s], now);
    expect(result).toHaveLength(1);
    expect(result[0].subId).toBe("sub-1");
  });

  it("returns sub when ends_at equals now", () => {
    const s = sub({ endsAt: now });
    const result = computeExpiries([s], now);
    expect(result).toHaveLength(1);
  });

  it("returns nothing when ends_at is in the future", () => {
    const s = sub({ endsAt: new Date("2026-06-01T00:00:00Z") });
    const result = computeExpiries([s], now);
    expect(result).toHaveLength(0);
  });

  it("returns multiple expired subs", () => {
    const subs = [
      sub({ subId: "sub-1", endsAt: new Date("2026-05-28T00:00:00Z") }),
      sub({ subId: "sub-2", endsAt: new Date("2026-05-27T00:00:00Z") }),
      sub({ subId: "sub-3", endsAt: new Date("2026-06-01T00:00:00Z") }),
    ];
    const result = computeExpiries(subs, now);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.subId).sort()).toEqual(["sub-1", "sub-2"]);
  });
});
