import { describe, it, expect } from "vitest";
import { mul, add, sub, gte, fromBps, toFixed, eq } from "./money";

describe("mul", () => {
  it("multiplies two decimal strings with 6dp precision", () => {
    expect(mul("9.99", "0.30")).toBe("2.997000");
  });
  it("handles zero", () => {
    expect(mul("0", "1000")).toBe("0.000000");
  });
  it("handles large numbers without precision loss", () => {
    expect(mul("1000000.000001", "2")).toBe("2000000.000002");
  });
});

describe("add", () => {
  it("adds two decimal strings", () => {
    expect(add("1.000001", "0.000001")).toBe("1.000002");
  });
  it("handles negative", () => {
    expect(add("10.000000", "-3.000000")).toBe("7.000000");
  });
});

describe("sub", () => {
  it("subtracts two decimal strings", () => {
    expect(sub("10.000000", "3.000000")).toBe("7.000000");
  });
  it("handles negative result (clawback path)", () => {
    expect(sub("1.000000", "5.000000")).toBe("-4.000000");
  });
});

describe("gte", () => {
  it("returns true when a >= b", () => {
    expect(gte("10.000000", "9.999999")).toBe(true);
    expect(gte("10.000000", "10.000000")).toBe(true);
  });
  it("returns false when a < b", () => {
    expect(gte("9.999999", "10.000000")).toBe(false);
  });
});

describe("fromBps", () => {
  it("computes amount * bps / 10000", () => {
    expect(fromBps("100.000000", 2000)).toBe("20.000000");
  });
  it("handles zero bps", () => {
    expect(fromBps("50.000000", 0)).toBe("0.000000");
  });
  it("handles 100% (10000 bps)", () => {
    expect(fromBps("50.000000", 10000)).toBe("50.000000");
  });
  it("throws on non-integer bps", () => {
    expect(() => fromBps("100.000000", 1500.5)).toThrow(/integer/);
  });
  it("throws on negative bps", () => {
    expect(() => fromBps("100.000000", -1)).toThrow(/range 0-10000/);
  });
  it("throws on bps > 10000", () => {
    expect(() => fromBps("100.000000", 10001)).toThrow(/range 0-10000/);
  });
});

describe("eq", () => {
  it("returns true for equal values", () => {
    expect(eq("10.000000", "10.000000")).toBe(true);
  });
  it("returns false for different values", () => {
    expect(eq("10.000000", "9.999999")).toBe(false);
  });
  it("handles zero correctly", () => {
    expect(eq("0.000000", "0.000000")).toBe(true);
  });
});

describe("toFixed", () => {
  it("rounds to 6 decimal places", () => {
    expect(toFixed("3.1415926535")).toBe("3.141593"); // rounds up
    expect(toFixed("3.1415924")).toBe("3.141592");    // rounds down
  });
  it("pads short strings", () => {
    expect(toFixed("1")).toBe("1.000000");
  });
  it("accepts both string and number", () => {
    expect(toFixed(1)).toBe("1.000000");
    expect(toFixed("2.5")).toBe("2.500000");
  });
});
