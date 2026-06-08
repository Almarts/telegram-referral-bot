import type { Context } from "grammy";
import { getDb } from "@/db/client";
import {
  users,
  invoices,
  subscriptions,
  commissionLedger,
  commissionConfig,
  subscriptionPlans,
} from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTron } from "@/lib/tron";
import { getEnv } from "@/lib/env";

export async function handleDashboard(ctx: Context): Promise<void> {
  const db = getDb();
  const tron = getTron();
  const hotSigner = tron.hotSigner();
  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;

  const [
    totalUsers,
    activeSubs,
    expiredSubs,
    paidToday,
    totalRevenue,
    pendingPayouts,
    hotUsdt,
    hotTrx,
    config,
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
        count: sql<number>`count(*)::int`,
      })
      .from(commissionLedger)
      .where(eq(commissionLedger.status, "payable"))
      .then((r) => r[0] ?? { total: "0", count: 0 }),

    tron.usdtBalance(hotSigner.address),
    tron.trxBalanceSun(hotSigner.address),
    db
      .select({ minPayout: commissionConfig.minPayoutUsdt })
      .from(commissionConfig)
      .limit(1)
      .then((r) => r[0] ?? null),

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
    `💸 Pending payouts: *${pendingPayouts.total} USDT* (${pendingPayouts.count})`,
    "",
    "*Hot wallet:*",
    `  USDT ${hotUsdt} | TRX ${hotTrx}`,
    "",
    "*Latest users:*",
    ...latestUsers.map(
      (u) =>
        `  • ${u.tgUsername ? `@${u.tgUsername}` : `id:${u.tgUserId}`} — ${new Date(u.createdAt).toISOString().slice(0, 10)}`,
    ),
    "",
    "Use /subs /finance /tree for details.",
  ];

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📊 Subs", callback_data: "admin:subs" },
          { text: "💰 Finance", callback_data: "admin:finance" },
          { text: "🌳 Tree", callback_data: "admin:tree" },
        ],
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

  switch (action) {
    case "dashboard":
      await handleDashboard(ctx);
      break;
    case "subs":
      // Import and call the subs handler — but we need to pass the ctx
      // to the existing handler. Since handleSubs uses ctx.reply, we can
      // just require and call.
      const { handleSubs } = await import("./admin_subs");
      await handleSubs(ctx);
      break;
    case "finance":
      const { handleFinance } = await import("./admin_finance");
      await handleFinance(ctx);
      break;
    case "tree":
      const { handleTree } = await import("./admin_tree");
      await handleTree(ctx);
    // no default
  }
}
