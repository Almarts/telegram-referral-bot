import Decimal from "decimal.js";

const DECIMAL_6 = 6;

function d(val: string | number): Decimal {
  return new Decimal(val);
}

/** Multiply two USD values (strings), return a 6dp string. */
export function mul(a: string, b: string): string {
  return d(a).mul(d(b)).toFixed(DECIMAL_6);
}

/** Add two USD values, return a 6dp string. */
export function add(a: string, b: string): string {
  return d(a).plus(d(b)).toFixed(DECIMAL_6);
}

/** Subtract b from a, return a 6dp string. */
export function sub(a: string, b: string): string {
  return d(a).minus(d(b)).toFixed(DECIMAL_6);
}

/** Returns true if a >= b. */
export function gte(a: string, b: string): boolean {
  return d(a).gte(d(b));
}

/** Compute amount * bps / 10000, return 6dp string. */
export function fromBps(amount: string, bps: number): string {
  if (!Number.isInteger(bps)) {
    throw new Error(`bps must be an integer, got ${bps}`);
  }
  if (bps < 0 || bps > 10000) {
    throw new Error(`bps must be in range 0-10000, got ${bps}`);
  }
  return d(amount).mul(bps).div(10000).toFixed(DECIMAL_6);
}

/** Returns true if a === b. */
export function eq(a: string, b: string): boolean {
  return d(a).eq(d(b));
}

/** Round and pad a value to exactly 6 decimal places. */
export function toFixed(val: string | number): string {
  return d(val).toFixed(DECIMAL_6);
}
