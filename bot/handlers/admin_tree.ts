import type { Context } from "grammy";
import { getDb } from "@/db/client";
import {
  users,
  invoices,
  subscriptionPlans,
} from "@/db/schema";
import { eq, sql, and, desc } from "drizzle-orm";

export async function handleTree(ctx: Context): Promise<void> {
  const db = getDb();

  // Parse optional ref_code from command
  const text = ctx.message?.text ?? "";
  const parts = text.split(/\s+/);
  const refCode = parts[1]?.toUpperCase();

  let rootRefCode: string;
  if (refCode) {
    // Verify the ref_code exists
    const exists = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.refCode, refCode))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!exists) {
      await ctx.reply(`❌ Ref code *${refCode}* not found.`, {
        parse_mode: "Markdown",
      });
      return;
    }
    rootRefCode = refCode;
  } else {
    // Default: use the admin's own ref_code
    const admin = await db
      .select({ refCode: users.refCode })
      .from(users)
      .where(eq(users.tgUserId, BigInt(ctx.from!.id)))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!admin?.refCode) {
      await ctx.reply("❌ You don't have a ref_code set.");
      return;
    }
    rootRefCode = admin.refCode;
  }

  // Fetch L1 referrals (direct)
  const l1Referrals = await db
    .select({
      tgUserId: users.tgUserId,
      tgUsername: users.tgUsername,
      refCode: users.refCode,
      createdAt: users.createdAt,
      role: users.role,
    })
    .from(users)
    .where(eq(users.parentRefCode, rootRefCode))
    .orderBy(desc(users.createdAt))
    .limit(100);

  // Count total L2 for each L1 (their referrals)
  const l2Counts = new Map<string, number>();
  if (l1Referrals.length > 0) {
    const l1Codes = l1Referrals
      .map((u) => u.refCode)
      .filter((c): c is string => !!c);

    if (l1Codes.length > 0) {
      for (const code of l1Codes) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.parentRefCode, code));
        l2Counts.set(code, count);
      }
    }
  }

  // Count how many L1 referrals have ever paid
  const l1Paids = new Map<string, number>();
  if (l1Referrals.length > 0) {
    for (const u of l1Referrals) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(distinct ${invoices.id})::int` })
        .from(invoices)
        .innerJoin(users, eq(users.id, invoices.userId))
        .where(
          and(eq(users.tgUserId, u.tgUserId), eq(invoices.status, "paid")),
        );
      l1Paids.set(String(u.tgUserId), count);
    }
  }

  // Total paid invoices from tree
  const [{ totalFromTree }] = await db
    .select({
      totalFromTree: sql<string>`coalesce(sum(${invoices.amountUsdt}), '0')`,
    })
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.userId))
    .where(
      and(
        eq(invoices.status, "paid"),
        eq(users.parentRefCode, rootRefCode),
      ),
    );

  const lines: string[] = [
    `🌳 *Referral Tree — ${rootRefCode}*`,
    "",
    `Direct referrals (L1): *${l1Referrals.length}*`,
    `Total USDT from tree: *${totalFromTree}*`,
    "",
  ];

  if (l1Referrals.length === 0) {
    lines.push("No referrals yet.");
  } else {
    for (let i = 0; i < l1Referrals.length; i++) {
      const u = l1Referrals[i];
      const userLabel = u.tgUsername
        ? `@${u.tgUsername}`
        : `tg://user?id=${u.tgUserId}`;
      const paidCount = l1Paids.get(String(u.tgUserId)) ?? 0;
      const l2 = l2Counts.get(u.refCode ?? "") ?? 0;
      const created = new Date(u.createdAt).toISOString().slice(0, 10);
      const role = u.role === "creator" ? "👑" : "";

      lines.push(
        `${i + 1}. ${role} ${userLabel} (ref: \`${u.refCode ?? "—"}\`)`,
      );
      lines.push(`   Joined: ${created} | Paid: ${paidCount}x | L2: ${l2}`);
    }
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}
