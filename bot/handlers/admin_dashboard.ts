import type { Context } from "grammy";
import { getDb } from "@/db/client";
import {
  users,
  invoices,
  subscriptions,
  commissionLedger,
} from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export async function handleDashboard(ctx: Context): Promise<void> {
  const db = getDb();

  const [
    totalUsers,
    activeSubs,
    expiredSubs,
    paidToday,
    totalRevenue,
    totalCommissionAccrued,
    latestUsers,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "expired"))
      .then((r) => r[0]?.count ?? 0),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(
        and(eq(invoices.status, "paid"), sql`${invoices.paidAt} > now() - interval '24 hours'`),
      )
      .then((r) => r[0]?.count ?? 0),

    db
      .select({
        total: sql<string>`coalesce(sum(${invoices.amountUsdt}), '0')`,
      })
      .from(invoices)
      .where(eq(invoices.status, "paid"))
      .then((r) => r[0]?.total ?? "0"),

    db
      .select({
        total: sql<string>`coalesce(sum(${commissionLedger.amountUsdt}), '0')`,
      })
      .from(commissionLedger)
      .where(eq(commissionLedger.status, "accrued"))
      .then((r) => r[0]?.total ?? "0"),

    db
      .select({
        tgUsername: users.tgUsername,
        tgUserId: users.tgUserId,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(5),
  ]);

  const lines: string[] = [
    "🏠 *Dashboard*",
    "",
    `👥 Users: *${totalUsers}* | ✅ Active: *${activeSubs}* | ❌ Expired: *${expiredSubs}*`,
    `📦 Paid today: *${paidToday}* | Total rev: *${totalRevenue} USDT*`,
    `💰 Accrued commissions: *${totalCommissionAccrued} USDT*`,
    "",
    "*Latest users:*",
    ...latestUsers.map(
      (u) =>
        `  • ${u.tgUsername ? `@${u.tgUsername}` : `id:${u.tgUserId}`} — ${new Date(u.createdAt).toISOString().slice(0, 10)}`,
    ),
  ];

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔄 Refresh", callback_data: "admin:dashboard" },
        ],
      ],
    },
  });
}

/** Handle callback navigation from dashboard buttons */
export async function handleDashboardCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("admin:")) return;

  const action = data.split(":")[1];
  await ctx.answerCallbackQuery();

  if (action === "dashboard") {
    await handleDashboard(ctx);
  }
}
