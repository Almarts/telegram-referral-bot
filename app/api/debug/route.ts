import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const issues: string[] = [];

  // 1. Check DB
  try {
    const db = getDb();
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .then((r) => r[0]?.count ?? -1);
    issues.push(`DB_OK users=${result}`);
  } catch (e) {
    issues.push(`DB_ERR ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Check env
  try {
    const { getEnv } = await import("@/lib/env");
    const env = getEnv();
    issues.push(`ENV_OK ADMIN_TG_IDS=${env.ADMIN_TG_IDS.map(String).join(",")}`);
    issues.push(`ENV_OK COLD=${env.TRON_COLD_WALLET_ADDRESS}`);
    issues.push(`ENV_OK BOT_TOKEN_LEN=${env.TELEGRAM_BOT_TOKEN.length}`);
  } catch (e) {
    issues.push(`ENV_ERR ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Check bot
  try {
    const { getBot } = await import("@/bot/bot");
    const bot = getBot();
    issues.push(`BOT_OK bot_created=true`);
    
    // Try to send a test message
    try {
      await bot.api.sendMessage(607645943, "🛠️ Debug endpoint works!");
      issues.push("SEND_OK");
    } catch (e: any) {
      issues.push(`SEND_ERR ${e.message}`);
    }
  } catch (e) {
    issues.push(`BOT_ERR ${e instanceof Error ? e.message : String(e)}`);
  }

  return new Response(JSON.stringify({ status: "ok", issues }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
