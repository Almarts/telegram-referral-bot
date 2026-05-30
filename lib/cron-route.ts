import { getKv } from "@/lib/kv";
import { createLeaseRunner } from "@/lib/cron-lease";
import { requireCronAuth } from "@/lib/api-auth";

/**
 * Run a cron route handler: authorize via CRON_SECRET, acquire a KV lease named
 * `name` for `ttlSeconds`, invoke `fn`, and return its result as JSON.
 *
 * If another tick still holds the lease, `fn` is skipped and `skipped: true` is
 * returned. Auth failure returns 401.
 */
export async function runCronJob<T extends object>(
  req: Request,
  name: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<Response> {
  if (!requireCronAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const withLease = createLeaseRunner(getKv());
  const result = await withLease(name, ttlSeconds, fn);

  if (result === undefined) {
    return Response.json({ skipped: true });
  }
  return Response.json(result);
}
