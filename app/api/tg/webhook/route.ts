import { webhookCallback } from "grammy";
import { getBot } from "@/bot/bot";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(req: Request): Promise<Response> {
  try {
    const env = getEnv();
    const bot = getBot();

    try {
      const clone = req.clone();
      const body = await clone.json();
      console.log("WEBHOOK_BODY", JSON.stringify(body).substring(0, 500));
    } catch (pe) {
      console.log("WEBHOOK_BODY_PARSE_FAIL", pe instanceof Error ? pe.message : String(pe));
    }

    const callback = webhookCallback(bot, "std/http");
    const result = await callback(req);
    console.log("WEBHOOK_OK", result.status);
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
    console.error("WEBHOOK_ERR", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  return handler(req);
}
