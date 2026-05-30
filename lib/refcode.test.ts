import { describe, it, expect, vi } from "vitest";
import { genRefCode, createUniqueRefCode } from "./refcode";

describe("genRefCode", () => {
  it("returns a 6-character string", () => {
    const code = genRefCode();
    expect(code).toHaveLength(6);
  });

  // Crockford base32 alphabet: 0-9, A-H, J-K, M-N, P-T, V-Z
  // Excludes I, L, O, U (ambiguous with 1, 1, 0, V)
  it("uses only Crockford base32 characters", () => {
    const valid = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;
    for (let i = 0; i < 100; i++) {
      expect(genRefCode()).toMatch(valid);
    }
  });

  it("is reasonably unique across a batch", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => genRefCode()));
    // 1000 codes from a 32^6 ≈ 1B space — collisions are astronomically unlikely
    // but the test should pass even with random overlap at this sample size.
    // The practical assertion: we generated at least 999 unique codes.
    expect(codes.size).toBeGreaterThanOrEqual(999);
  });
});

describe("createUniqueRefCode", () => {
  it("returns a code that passes the tryInsert check", async () => {
    const tryInsert = vi.fn().mockResolvedValue(true);
    const code = await createUniqueRefCode(tryInsert);
    expect(code).toHaveLength(6);
    expect(tryInsert).toHaveBeenCalledTimes(1);
    expect(tryInsert).toHaveBeenCalledWith(code);
  });

  it("retries on collision", async () => {
    const calls: string[] = [];
    const tryInsert = vi.fn().mockImplementation(async (code: string) => {
      calls.push(code);
      return calls.length >= 3; // succeed on 3rd attempt
    });
    const code = await createUniqueRefCode(tryInsert);
    expect(calls).toHaveLength(3);
    expect(code).toBe(calls[2]); // the third code was the one that worked
  });

  it("throws after maxAttempts failures", async () => {
    const tryInsert = vi.fn().mockResolvedValue(false);
    await expect(createUniqueRefCode(tryInsert, 3)).rejects.toThrow(/unique ref code/);
    expect(tryInsert).toHaveBeenCalledTimes(3);
  });
});
