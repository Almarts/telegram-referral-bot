import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  ADMIN_API_SECRET: z.string().min(16).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  DEFAULT_CHANNEL_ID: z.string().regex(/^-?\d+$/).transform(BigInt),
  TRON_DEPOSIT_XPRV: z.string().min(1),
  TRON_HOT_WALLET_PK: z.string().min(1),
  TRON_COLD_WALLET_ADDRESS: z.string().length(34).startsWith("T", "TRON_COLD_WALLET_ADDRESS must start with T"),
  TRONGRID_API_KEY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url().startsWith("https://", "UPSTASH_REDIS_REST_URL must use https"),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  ADMIN_TG_IDS: z
    .string()
    .regex(
      /^(\s*\d+\s*(,\s*\d+\s*)*)?$/,
      "ADMIN_TG_IDS must be a comma-separated list of integers (or empty for no admins)",
    )
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => BigInt(x)),
    ),
  // kept as string so callers parse with decimal.js (USDT has 6 decimals; Number loses precision)
  MAX_PAYOUT_PER_TX_USDT: z.string().regex(/^\d+(\.\d+)?$/),
  MAX_PAYOUTS_PER_HOUR: z.string().regex(/^\d+$/).transform(Number),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(src: Record<string, string | undefined> = process.env): Env {
  return schema.parse(src);
}

// Cache stays null until a successful parse. If parseEnv() throws, cache
// remains null and the next call will re-attempt — correct for serverless
// cold starts with transient env misconfiguration.
let _envCache: Env | null = null;
export function getEnv(): Env {
  if (_envCache === null) _envCache = parseEnv();
  return _envCache;
}
