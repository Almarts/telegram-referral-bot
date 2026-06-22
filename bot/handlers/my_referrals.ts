import type { Context } from "grammy";
import { getDb } from "@/db/client";
import { users, invoices, commissionLedger } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function handleMyReferrals(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  try {
    const db = getDb();

    const user = await db
      .select({
        id: users.id,
        refCode: users.refCode,
        role: users.role,
        vipBps: users.vipBps,
      })
      .from(users)
      .where(eq(users.tgUserId, BigInt(tgUser.id)))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!user) {
      await ctx.reply("No account found. Use /start first.");
      return;
    }

    // Count L1 referrals (users who used this user's ref_code)
    const l1Count = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.parentRefCode, user.refCode))
      .then((r) => r[0]?.count ?? 0);

    // Get L1 users' IDs
    const l1Users = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.parentRefCode, user.refCode));

    // Count paid invoices from L1 users
    let l1Paid = 0;
    if (l1Users.length > 0) {
      const l1Ids = l1Users.map((u) => u.id);
      const paid = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(
          and(
            eq(invoices.status, "paid"),
            sql`${invoices.userId} = ANY(ARRAY[${sql.join(l1Ids.map((id) => sql`${id}::uuid`), sql`, `)}])`
          )
        )
        .then((r) => r[0]?.count ?? 0);
      l1Paid = paid;
    }

    // Count L2 referrals (users who used L1's ref_codes)
    let l2Count = 0;
    let l2Paid = 0;
    const l1RefCodes = l1Users
      .map((u) => u.id)
      .filter(Boolean);
    if (l1RefCodes.length > 0) {
      const l1RefCodeValues = await db
        .select({ refCode: users.refCode })
        .from(users)
        .where(
          sql`${users.id} = ANY(ARRAY[${sql.join(l1RefCodes.map((id) => sql`${id}::uuid`), sql`, `)}])`
        );

      const refCodes = l1RefCodeValues.map((r) => r.refCode).filter(Boolean);
      if (refCodes.length > 0) {
        const l2Users = await db
          .select({ id: users.id })
          .from(users)
          .where(
            sql`${users.parentRefCode} = ANY(ARRAY[${sql.join(refCodes.map((c) => sql`${c}`), sql`, `)}])`
          );
        l2Count = l2Users.length;

        if (l2Users.length > 0) {
          const l2Ids = l2Users.map((u) => u.id);
          const paid2 = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(invoices)
            .where(
              and(
                eq(invoices.status, "paid"),
                sql`${invoices.userId} = ANY(ARRAY[${sql.join(l2Ids.map((id) => sql`${id}::uuid`), sql`, `)}])`
              )
            )
            .then((r) => r[0]?.count ?? 0);
          l2Paid = paid2;
        }
      }
    }

    // Commission rate
    const commissionPct = user.role === "creator" && user.vipBps ? user.vipBps / 100 : 10;

    const botUsername = "WhaleReferral_bot";
    const referralLink = `https://t.me/${botUsername}?start=${user.refCode}`;

    let msg = `My referrals

Referral link: ${referralLink}

Direct (L1): ${l1Count} users
L1 paid invoices: ${l1Paid}
Commission: ${commissionPct}%`;
    if (l2Count > 0) {
      msg += `

Indirect (L2): ${l2Count} users
L2 paid invoices: ${l2Paid}`;
    }

    await ctx.reply(msg);
  } catch (e) {
    await ctx.reply("Error loading stats. Try again later.");
  }
}
