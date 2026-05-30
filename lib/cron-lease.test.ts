import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLeaseRunner, InMemoryKV } from "./cron-lease";

describe("InMemoryKV", () => {
  let kv: InMemoryKV;

  beforeEach(() => {
    kv = new InMemoryKV();
  });

  it("set NX EX succeeds when key is free", async () => {
    const result = await kv.set("cron:test", "run-1", { nx: true, ex: 90 });
    expect(result).toBe("OK");
  });

  it("set NX EX returns null when key is held", async () => {
    await kv.set("cron:test", "run-1", { nx: true, ex: 90 });
    const result = await kv.set("cron:test", "run-2", { nx: true, ex: 90 });
    expect(result).toBeNull();
  });

  it("del removes the key", async () => {
    await kv.set("cron:test", "x", { nx: true, ex: 90 });
    await kv.del("cron:test");
    const result = await kv.set("cron:test", "y", { nx: true, ex: 90 });
    expect(result).toBe("OK");
  });
});

describe("withLease", () => {
  let kv: InMemoryKV;
  let withLease: ReturnType<typeof createLeaseRunner>;

  beforeEach(() => {
    kv = new InMemoryKV();
    withLease = createLeaseRunner(kv);
  });

  it("executes fn when lease is acquired", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    const result = await withLease("test", 90, fn);
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("skips fn when lease is already held (concurrent tick)", async () => {
    await kv.set("cron:test", "existing", { nx: true, ex: 90 });

    const fn = vi.fn();
    const result = await withLease("test", 90, fn);

    expect(result).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it("releases lease when fn succeeds", async () => {
    await withLease("test", 90, vi.fn().mockResolvedValue(undefined));

    const fn2 = vi.fn().mockResolvedValue("second");
    const result = await withLease("test", 90, fn2);
    expect(result).toBe("second");
  });

  it("releases lease when fn throws", async () => {
    const bad = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withLease("test", 90, bad)).rejects.toThrow("boom");

    const fn2 = vi.fn().mockResolvedValue("recovered");
    const result = await withLease("test", 90, fn2);
    expect(result).toBe("recovered");
  });

  it("allows different cron names concurrently", async () => {
    const fn1 = vi.fn().mockResolvedValue("a");
    const fn2 = vi.fn().mockResolvedValue("b");
    const [r1, r2] = await Promise.all([
      withLease("job-a", 90, fn1),
      withLease("job-b", 90, fn2),
    ]);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("prefixes lease key with 'cron:'", async () => {
    await kv.set("cron:test", "manual-hold", { nx: true, ex: 90 });

    const fn = vi.fn();
    await withLease("test", 90, fn);

    expect(fn).not.toHaveBeenCalled();
  });
});
