/**
 * In-memory KV store for testing -- mimics the Upstash Redis SET/DEL contract.
 */
export class InMemoryKV {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async set(
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number },
  ): Promise<string | null> {
    const now = Date.now();

    if (this.store.has(key)) {
      const entry = this.store.get(key)!;
      if (entry.expiresAt > 0 && entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }

    if (opts?.nx && this.store.has(key)) {
      return null;
    }

    const expiresAt = opts?.ex ? now + opts.ex * 1000 : 0;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(key: string): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (entry && entry.expiresAt > 0 && entry.expiresAt <= now) {
      this.store.delete(key);
      return 0;
    }
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  /** Compare-and-delete Lua script used by withLease. */
  async eval(
    _script: string,
    keys: string[],
    argv: string[],
  ): Promise<number> {
    const key = keys[0];
    const expectedValue = argv[0];
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || (entry.expiresAt > 0 && entry.expiresAt <= now)) {
      this.store.delete(key);
      return 0;
    }

    if (entry.value === expectedValue) {
      this.store.delete(key);
      return 1;
    }

    return 0;
  }
}

export interface LeaseKV {
  set(
    key: string,
    value: string,
    opts?: { nx?: boolean; ex?: number },
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  eval?(
    script: string,
    keys: string[],
    argv: string[],
  ): Promise<number>;
}

const PREFIX = "cron:";

/**
 * Create a withLease runner bound to a specific KV client.
 *
 * Safety: the finally block uses a Lua compare-and-delete so that a
 * long-running tick whose lease has expired does NOT accidentally
 * revoke the lease of a new tick that acquired the same key.
 */
export function createLeaseRunner(kv: LeaseKV) {
  return async function withLease<T>(
    name: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const key = `${PREFIX}${name}`;
    const runId = crypto.randomUUID();

    const acquired = await kv.set(key, runId, { nx: true, ex: ttlSeconds });
    if (acquired !== "OK") return undefined;

    try {
      return await fn();
    } finally {
      // Compare-and-delete: only remove if this run's ID is still the holder
      if (kv.eval) {
        await kv.eval(
          "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
          [key],
          [runId],
        );
      } else {
        await kv.del(key);
      }
    }
  };
}
