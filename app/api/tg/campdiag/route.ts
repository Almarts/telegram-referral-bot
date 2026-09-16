import { NextResponse } from "next/server";
import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Diagnostic: replay a synthetic /campaign message through the real bot so we
 * can see where the handler bails out.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const text = url.searchParams.get("text") ?? "/campaign";
  const fromId = url.searchParams.get("from") ?? "607645943";

  const steps: string[] = [];

  try {
    const env = getEnv();
    const adminIds = env.ADMIN_TG_IDS;
    steps.push(
      `ADMIN_TG_IDS=${adminIds.map(String).join(",")} from=${fromId} match=${adminIds.includes(BigInt(fromId))}`,
    );

    const db = getDb();
    const u = await db
      .select({ id: users.id, refCode: users.refCode, role: users.role })
      .from(users)
      .where(eq(users.tgUserId, BigInt(fromId)))
      .limit(1)
      .then((r) => r[0] ?? null);
    steps.push(`userRow=${JSON.stringify(u)}`);

    if (!u) return NextResponse.json({ steps, verdict: "NO_USER_ROW" });
    if (!u.refCode) return NextResponse.json({ steps, verdict: "NO_REF_CODE" });

    steps.push(`channelId=${String(env.DEFAULT_CHANNEL_ID)}`);
    steps.push(`text=${text}`);

    // Verify bot can still create invite links in the channel
    const bot = getBot();
    const inv = await bot.api.createChatInviteLink(
      Number(env.DEFAULT_CHANNEL_ID),
      { name: "__campdiag__" },
    );
    steps.push(`inviteOK=${inv.invite_link}`);
    await bot.api.revokeChatInviteLink(
      Number(env.DEFAULT_CHANNEL_ID),
      inv.invite_link,
    );
    steps.push("revoked");

    return NextResponse.json({ steps, verdict: "ALL_GOOD" });
  } catch (e) {
    steps.push("ERR: " + (e instanceof Error ? `${e.message}` : String(e)));
    return NextResponse.json({ steps, verdict: "ERROR" }, { status: 200 });
  }
}
