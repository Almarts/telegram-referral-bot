import type { Context, NextFunction } from "grammy";
import { getEnv } from "@/lib/env";

export async function adminOnly(ctx: Context, next: NextFunction): Promise<void> {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) return;

  const adminIds = getEnv().ADMIN_TG_IDS;
  if (!adminIds.includes(BigInt(tgUserId))) return;

  await next();
}
