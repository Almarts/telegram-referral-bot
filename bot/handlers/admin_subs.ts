import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { subscriptions, subscriptionPlans, invoices, users } from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export async function handleSubs(ctx: Context): Promise<void> {
  const db = getDb();

  const [totalUsers, activeSubs, expiredSubs, byPlan, recentActivities] =
    await Promise.all([
      // Total registered users
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .then((r) => r[0]?.count ?? 0),

      // Active subscriptions
      db
        .select({
          count: sql<number>`count(*)::int`,
          uniqueUsers: sql<number>`count(distinct ${subscriptions.userId})::int`,
        })
        .from(subscriptions)
        .where(eq(subscriptions.status, "active"))
        .then((r) => r[0] ?? { count: 0, uniqueUsers: 0 }),

      // Expired subscriptions
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscriptions)
        .where(eq(subscriptions.status, "expired"))
        .then((r) => r[0]?.count ?? 0),

      // Active subs grouped by plan: subs -> invoices -> subscriptionPlans
      db
        .select({
          planName: subscriptionPlans.name,
          count: sql<number>`count(*)::int`,
        })
        .from(subscriptions)
        .innerJoin(invoices, eq(invoices.id, subscriptions.invoiceId))
        .innerJoin(
          subscriptionPlans,
          eq(subscriptionPlans.id, invoices.planId),
        )
        .where(eq(subscriptions.status, "active"))
        .groupBy(subscriptionPlans.name)
        .then((r) => r),

      // Recent paid invoices (last 24h)
      db
        .select({
          tgUsername: users.tgUsername,
          planName: subscriptionPlans.name,
          amountUsdt: invoices.amountUsdt,
          paidAt: invoices.paidAt,
        })
        .from(invoices)
        .innerJoin(users, eq(users.id, invoices.userId))
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, invoices.planId))
        .where(
          and(
            eq(invoices.status, "paid"),
            sql`${invoices.paidAt} > now() - interval '24 hours'`,
          ),
        )
        .orderBy(desc(invoices.paidAt))
        .limit(10),
    ]);

  const lines: string[] = ["📊 *Subscribers*", ""];

  lines.push(`👥 Total registered: *${totalUsers}*`);
  lines.push(
    `✅ Active subscriptions: *${activeSubs.count}* (${activeSubs.uniqueUsers} users)`,
  );
  lines.push(`❌ Expired: *${expiredSubs}*`);

  if (byPlan.length > 0) {
    lines.push("");
    lines.push("*By plan:*");
    for (const plan of byPlan) {
      lines.push(`  • ${plan.planName}: ${plan.count}`);
    }
  }

  if (recentActivities.length > 0) {
    lines.push("");
    lines.push("*Recent payments (24h):*");
    for (const p of recentActivities) {
      const user = p.tgUsername ? `@${p.tgUsername}` : "—";
      const time = p.paidAt
        ? new Date(p.paidAt).toISOString().slice(11, 16)
        : "?";
      lines.push(`  • ${time} ${user} — ${p.planName} (${p.amountUsdt} USDT)`);
    }
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}
