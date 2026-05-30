import { getEnv } from "@/lib/env";

/** Constant-shape Bearer check against a known secret. */
function checkBearer(req: Request, secret: string): boolean {
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Authorize a cron route via CRON_SECRET. */
export function requireCronAuth(req: Request): boolean {
  return checkBearer(req, getEnv().CRON_SECRET);
}

/**
 * Authorize an admin mutation route. Prefers ADMIN_API_SECRET; falls back to
 * CRON_SECRET when no dedicated admin secret is configured.
 */
export function requireAdminAuth(req: Request): boolean {
  const env = getEnv();
  return checkBearer(req, env.ADMIN_API_SECRET ?? env.CRON_SECRET);
}
