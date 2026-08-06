import { describe, it, expect } from "vitest";
import { parseFreePayload, freeCodeKey } from "./freegrant";

describe("freegrant — parseFreePayload", () => {
  it("parses a valid free_ code payload", () => {
    expect(parseFreePayload("free_AbC123xyz789AbC123xyz789")).toBe("AbC123xyz789AbC123xyz789");
  });

  it("rejects a regular ref code payload (no free_ prefix)", () => {
    expect(parseFreePayload("ABCD1234")).toBeNull();
  });

  it("rejects empty / undefined payload", () => {
    expect(parseFreePayload(undefined)).toBeNull();
    expect(parseFreePayload("")).toBeNull();
  });

  it("rejects too-short codes", () => {
    expect(parseFreePayload("free_short")).toBeNull();
  });
});

describe("freegrant — freeCodeKey", () => {
  it("prefixes the KV key", () => {
    expect(freeCodeKey("abc")).toBe("freegrant:abc");
  });
});
