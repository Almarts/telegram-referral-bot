import pino from "pino";

const REDACT_KEYS = [
  "TRON_DEPOSIT_XPRV",
  "TRON_HOT_WALLET_PK",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "CRON_SECRET",
  "DATABASE_URL",
  "TRONGRID_API_KEY",
  "text",
  "message_text",
  "body",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: REDACT_KEYS,
    censor: "[REDACTED]",
  },
});

export type Logger = typeof logger;
