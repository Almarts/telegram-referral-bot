import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(8),
  DEFAULT_CHANNEL_ID: z.string().regex(/^-?\d+$/).transform(BigInt),
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
});

export type Env = z.infer<typeof schema>;

export function parseEnv(src: Record<string, string | undefined> = process.env): Env {
  return schema.parse(src);
}

let _envCache: Env | null = null;
export function getEnv(): Env {
  if (_envCache === null) _envCache = parseEnv();
  return _envCache;
}
