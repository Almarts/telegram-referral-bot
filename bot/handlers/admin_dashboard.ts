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
        total: sql<string>`coalesce(sum(${commissionLedger.amountUsdt}), 0)`,
      })
      .from(commissionLedger)
      .where(eq(commissionLedger.status, "accrued"))
      .then((r) => r[0]?.total ?? "0"),

    db
      .select({
        tgUsername: users.tgUsername,
        tgUserId: users.tgUserId,
        createdAt: users.createdAt,
        lastPaidAt: sql`max(${invoices.paidAt})`,
      })
      .from(users)
      .innerJoin(invoices, and(
        eq(invoices.userId, users.id),
        eq(invoices.status, "paid"),
      ))
      .groupBy(users.id, users.tgUsername, users.tgUserId, users.createdAt)
      .orderBy(desc(sql`max(${invoices.paidAt})`))
      .limit(5),
  ]);

  const lines: string[] = [
    "🏠 *Dashboard*",
    "",
    `👥 Users: *${totalUsers}* | ✅ Active: *${activeSubs}* | ❌ Expired: *${expiredSubs}*`,
    `📦 Paid today: *${paidToday}* | Total rev: *${totalRevenue} TRX*`,
    `💰 Accrued commissions: *${totalCommissionAccrued} TRX*`,
    "",
    "*Latest paid:*",
    ...latestUsers.map(
      (u) =>
        `  • ${u.tgUsername ? `@${u.tgUsername}` : `id:${u.tgUserId}`} — ${u.lastPaidAt ? new Date(u.lastPaidAt).toISOString().slice(0, 10) : "—"}`,
    ),
  ];

  // Try with text-only first, then with Markdown
  try {
    await ctx.reply(lines.join("\n"), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Refresh", callback_data: "admin:dashboard" },
            { text: "📋 All users", callback_data: "admin:users" },
          ],
        ],
      },
    });
  } catch {
    await ctx.reply(lines.join("\n"), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Refresh", callback_data: "admin:dashboard" },
            { text: "📋 All users", callback_data: "admin:users" },
          ],
        ],
      },
    });
  }
}

/** Handle callback navigation from dashboard buttons */
export async function handleDashboardCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("admin:")) return;

  const action = data.split(":")[1];
  await ctx.answerCallbackQuery();

  if (action === "dashboard") {
    await handleDashboard(ctx);
  } else if (action === "users") {
    const filter = data.split(":")[2];
    if (filter === "paid") {
      await handleAllUsers(ctx, true);
    } else {
      await handleAllUsers(ctx, false);
    }
  }
}

/**
 * Show users — optionally only those who paid.
 */
async function handleAllUsers(ctx: Context, onlyPaid: boolean = false): Promise<void> {
  const db = getDb();

  const rows = await db
    .select({
      tgUsername: users.tgUsername,
      tgUserId: users.tgUserId,
      role: users.role,
      createdAt: users.createdAt,
      lastPaidAt: sql`max(${invoices.paidAt})`,
      totalPaid: sql<string>`coalesce(sum(case when ${invoices.status} = 'paid' then ${invoices.amountUsdt} else '0' end), '0')`,
      paidCount: sql<number>`count(*) filter (where ${invoices.status} = 'paid')::int`,
    })
    .from(users)
    .leftJoin(invoices, eq(invoices.userId, users.id))
    .groupBy(users.id, users.tgUsername, users.tgUserId, users.role, users.createdAt)
    .orderBy(desc(sql`max(${invoices.paidAt}) nulls last`), desc(users.createdAt))
    .limit(50);

  if (rows.length === 0) {
    await ctx.reply("No users yet.");
    return;
  }

  // If onlyPaid=true, filter to those with at least one payment
  const filtered = onlyPaid ? rows.filter((r) => r.paidCount > 0) : rows;

  if (filtered.length === 0) {
    await ctx.reply("Нет пользователей с оплатой.");
    return;
  }

  const title = onlyPaid
    ? `📋 *Оплатившие (${filtered.length})*`
    : `📋 *Все пользователи (${filtered.length})*`;

  const lines: string[] = [
    title,
    "",
    ...filtered.map((r, i) => {
      const name = r.tgUsername ? `@${r.tgUsername}` : `id:${r.tgUserId}`;
      const role = r.role === "creator" ? "🎥" : "👤";
      const lastPaid = r.lastPaidAt
        ? new Date(r.lastPaidAt).toISOString().slice(0, 10)
        : "—";
      return `${i + 1}. ${role} ${name} | paid: *${r.totalPaid} TRX* (${r.paidCount}x) | last: ${lastPaid}`;
    }),
  ];

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: onlyPaid ? "📋 Все" : "💳 Оплатившие", callback_data: `admin:users:${onlyPaid ? "all" : "paid"}` },
        ],
        [{ text: "🔙 Back to Dashboard", callback_data: "admin:dashboard" }],
      ],
    },
  });
}

/**
 * Handle admin:users:paid / admin:users:all callback to toggle filter
 */
async function handleUsersFilter(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  const parts = data.split(":");
  if (parts[1] !== "users") return;
  const filter = parts[2] ?? "all";
  await ctx.answerCallbackQuery();
  if (filter === "paid") {
    await handleAllUsers(ctx, true);
  } else {
    await handleAllUsers(ctx, false);
  }
}
