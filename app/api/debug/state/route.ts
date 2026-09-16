import { getDb } from "@/db/client";
import { users, freeTrialGrants, subscriptions, invoices, campaignJoins } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonSafe(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)),
  );
}

/** Read-only full state for one Telegram user. */
export async function GET(req: Request): Promise<Response> {
  const tgParam = new URL(req.url).searchParams.get("tg");
  if (!tgParam || !/^[0-9]+$/.test(tgParam)) {
    return Response.json({ ok: false, error: "pass ?tg=<telegram_user_id>" }, { status: 400 });
  }
  const TG_ID = BigInt(tgParam);
  const db = getDb();
  try {
    const u = await db
      .select({
        id: users.id,
        username: users.tgUsername,
        refCode: users.refCode,
        parentRefCode: users.parentRefCode,
      })
      .from(users)
      .where(sql`${users.tgUserId} = ${TG_ID}`)
      .limit(1)
      .then((r) => r[0] ?? null);

    const grants = await db
      .select({
        src: freeTrialGrants.source,
        days: freeTrialGrants.days,
        at: freeTrialGrants.grantedAt,
      })
      .from(freeTrialGrants)
      .where(sql`${freeTrialGrants.tgUserId} = ${TG_ID}`)
      .orderBy(desc(freeTrialGrants.grantedAt));

    const joins = await db
      .select({ state: campaignJoins.state, at: campaignJoins.joinedAt })
      .from(campaignJoins)
      .where(sql`${campaignJoins.tgUserId} = ${TG_ID}`)
      .orderBy(desc(campaignJoins.joinedAt));

    let subs: unknown[] = [];
    let invs: unknown[] = [];
    if (u) {
      subs = await db
        .select({
          status: subscriptions.status,
          startsAt: subscriptions.startsAt,
          endsAt: subscriptions.endsAt,
        })
        .from(subscriptions)
        .where(sql`${subscriptions.userId} = ${u.id}`)
        .orderBy(desc(subscriptions.endsAt));
      invs = await db
        .select({ status: invoices.status, amount: invoices.amountUsdt })
        .from(invoices)
        .where(sql`${invoices.userId} = ${u.id}`)
        .orderBy(desc(invoices.createdAt));
    }

    return Response.json(
      jsonSafe({ ok: true, user: u, grants, joins, subs, invs }) as object,
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
