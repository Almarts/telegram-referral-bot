import { getDb } from "@/db/client";
import { subscriptions } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";

export interface ActiveSubscription {
  id: string;
  startsAt: Date;
  endsAt: Date;
  channelId: bigint;
}

/**
 * Return the user's currently live subscription, or null.
 *
 * A subscription counts as live when its status is `active` AND its ends_at is
 * still in the future. Used to let a user who already consumed their trial
 * re-enter the channel while their access is still valid.
 */
export async function findActiveSubscription(
  userId: string,
): Promise<ActiveSubscription | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: subscriptions.id,
      startsAt: subscriptions.startsAt,
      endsAt: subscriptions.endsAt,
      channelId: subscriptions.channelId,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        gt(subscriptions.endsAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
