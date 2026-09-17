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

  it("returns T-7d nudge when ends_at is exactly 7 days from now", () => {
    const s = sub({ endsAt: new Date("2026-06-05T00:00:00Z") }); // 7d from now
    const result = computeNudges([s], new Set(), now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ subId: "sub-1", window: "7d" });
  });

  it("returns T-24h nudge when ends_at is 24h from now", () => {
    const s = sub({ endsAt: new Date("2026-05-30T00:00:00Z") }); // 24h from now
    const result = computeNudges([s], new Set(), now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ subId: "sub-1", window: "24h" });
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
    const s = sub({ endsAt: new Date("2026-06-05T00:00:00Z") }); // 7d
    const result = computeNudges([s], new Set(["sub-1:7d"]), now);
    expect(result).toHaveLength(0);
  });

  it("returns single nudge even when sub falls in two windows", () => {
    // If a sub is at exactly T-24h but T-7d was already sent, only T-24h returns
    const s = sub({ endsAt: new Date("2026-05-30T00:00:00Z") }); // 24h
    const alreadySent = new Set(["sub-1:7d"]);
    const result = computeNudges([s], alreadySent, now);
    expect(result).toHaveLength(1);
    expect(result[0].window).toBe("24h");
  });

  it("processes multiple subs independently", () => {
    const subs = [
      sub({ subId: "sub-1", endsAt: new Date("2026-06-05T00:00:00Z") }),
      sub({ subId: "sub-2", endsAt: new Date("2026-05-30T00:00:00Z") }),
    ];
    const result = computeNudges(subs, new Set(), now);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.window).sort()).toEqual(["24h", "7d"]);
  });

  it("catches a sub whose deadline passed between two hourly ticks (regression)", () => {
    // Cron runs hourly, so a tick can land up to an hour after the moment the
    // sub entered the T-7d window. The window must be wide enough to cover that
    // whole gap; when it was only 60s wide, these subs slipped through and no
    // reminder was ever delivered.
    const firstTickOfHour = new Date("2026-05-29T00:00:00Z");
    // ends_at = 7d + 53min from the tick -> entered the T-7d window 53 min ago,
    // i.e. strictly inside [7d, 7d + 1h) measured from this tick.
    const s = sub({
      endsAt: new Date(
        firstTickOfHour.getTime() + 7 * 24 * 60 * 60 * 1000 + 53 * 60 * 1000,
      ),
    });
    const result = computeNudges([s], new Set(), firstTickOfHour);
    expect(result).toHaveLength(1);
    expect(result[0].window).toBe("7d");
  });

  it("does not re-send within the same window across consecutive hourly ticks", () => {
    const tick = new Date("2026-05-29T00:00:00Z");
    const s = sub({
      endsAt: new Date(tick.getTime() + 7 * 24 * 60 * 60 * 1000 + 53 * 60 * 1000),
    });
    expect(computeNudges([s], new Set(), tick)).toHaveLength(1);
    // next hourly tick, same window — already recorded, must stay silent
    const nextTick = new Date(tick.getTime() + 60 * 60 * 1000);
    expect(computeNudges([s], new Set(["sub-1:7d"]), nextTick)).toHaveLength(0);
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
