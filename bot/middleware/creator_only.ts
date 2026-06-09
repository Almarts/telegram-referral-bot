import type { Context, NextFunction } from "grammy";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Middleware that only passes if the user has role = "creator".
 * If regular, silently ignores (no reply — the button shouldn't be visible anyway).
 */
export async function creatorOnly(ctx: Context, next: NextFunction): Promise<void> {
  const tgUserId = ctx.from?.id;
  if (!tgUserId) return;

  const db = getDb();
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUserId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user || user.role !== "creator") return;

  await next();
}
