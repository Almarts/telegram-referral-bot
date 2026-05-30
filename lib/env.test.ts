import { describe, it, expect } from "vitest";
import { parseEnv, getEnv } from "./env";

function completeEnv(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://x",
    CRON_SECRET: "abcdefghijklmnop",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_SECRET: "supersecret123",
    DEFAULT_CHANNEL_ID: "-1001234567890",
    TRON_DEPOSIT_XPRV: "xprv...",
    TRON_HOT_WALLET_PK: "0x...",
    TRON_COLD_WALLET_ADDRESS: "TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    TRONGRID_API_KEY: "k",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "t",
    ADMIN_TG_IDS: "1,2,3",
    MAX_PAYOUT_PER_TX_USDT: "1000",
    MAX_PAYOUTS_PER_HOUR: "30",
  };
}

describe("parseEnv", () => {
  it("rejects when required keys are missing", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("returns typed env when complete", () => {
    const env = parseEnv(completeEnv());
    expect(env.DEFAULT_CHANNEL_ID).toBe(-1001234567890n);
    expect(env.ADMIN_TG_IDS).toEqual([1n, 2n, 3n]);
    expect(env.MAX_PAYOUTS_PER_HOUR).toBe(30);
  });

  it("rejects ADMIN_TG_IDS with non-numeric tokens", () => {
    expect(() =>
      parseEnv({ ...completeEnv(), ADMIN_TG_IDS: "1,abc,3" }),
    ).toThrow(/ADMIN_TG_IDS/);
  });

  it("rejects DEFAULT_CHANNEL_ID with non-digits", () => {
    expect(() =>
      parseEnv({ ...completeEnv(), DEFAULT_CHANNEL_ID: "-100abc" }),
    ).toThrow(/DEFAULT_CHANNEL_ID/);
  });

  it("rejects MAX_PAYOUT_PER_TX_USDT with trailing dot", () => {
    expect(() =>
      parseEnv({ ...completeEnv(), MAX_PAYOUT_PER_TX_USDT: "5." }),
    ).toThrow(/MAX_PAYOUT_PER_TX_USDT/);
  });

  it("rejects UPSTASH_REDIS_REST_URL with http scheme", () => {
    expect(() =>
      parseEnv({ ...completeEnv(), UPSTASH_REDIS_REST_URL: "http://example.upstash.io" }),
    ).toThrow(/UPSTASH_REDIS_REST_URL/);
  });
});

describe("getEnv", () => {
  const defaults: Record<string, string> = {
    DATABASE_URL: "postgres://x",
    CRON_SECRET: "abcdefghijklmnop",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_SECRET: "supersecret123",
    DEFAULT_CHANNEL_ID: "-1001234567890",
    TRON_DEPOSIT_XPRV: "xprv...",
    TRON_HOT_WALLET_PK: "0x...",
    TRON_COLD_WALLET_ADDRESS: "TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    TRONGRID_API_KEY: "k",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "t",
    ADMIN_TG_IDS: "1,2,3",
    MAX_PAYOUT_PER_TX_USDT: "1000",
    MAX_PAYOUTS_PER_HOUR: "30",
  };

  it("returns a parsed Env from process.env", () => {
    for (const [key, val] of Object.entries(defaults)) {
      (process.env as Record<string, string>)[key] = val;
    }

    const env = getEnv();
    expect(env.DATABASE_URL).toBe("postgres://x");
    expect(env.DEFAULT_CHANNEL_ID).toBe(-1001234567890n);
    expect(env.ADMIN_TG_IDS).toEqual([1n, 2n, 3n]);
  });

  it("returns the same object on repeated calls (memoization identity)", () => {
    expect(getEnv()).toBe(getEnv());
  });
});
