import { Redis } from "@upstash/redis";
import { getEnv } from "@/lib/env";

let _kv: Redis | null = null;

/** Shared lazy-singleton Upstash Redis client. */
export function getKv(): Redis {
  if (!_kv) {
    _kv = new Redis({
      url: getEnv().UPSTASH_REDIS_REST_URL,
      token: getEnv().UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _kv;
}

/**
 * Acquire a single-slot, TTL'd cooldown for `key`.
 *
 * Returns true if acquired (the caller may proceed), false if a previous
 * acquire is still within its TTL window. Backed by SET NX EX — the same
 * primitive the cron lease uses, scoped to a per-key cooldown.
 */
export async function cooldown(key: string, ttlSeconds: number): Promise<boolean> {
  const acquired = await getKv().set(key, "1", { nx: true, ex: ttlSeconds });
  return acquired === "OK";
}
