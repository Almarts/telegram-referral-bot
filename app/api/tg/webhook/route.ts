import { webhookCallback } from "grammy";
import { getBot } from "@/bot/bot";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let _handler: ((req: Request) => Promise<Response>) | null = null;

function getHandler(): (req: Request) => Promise<Response> {
  if (!_handler) {
    _handler = webhookCallback(getBot(), "std/http", {
      secretToken: getEnv().TELEGRAM_WEBHOOK_SECRET,
    });
  }
  return _handler;
}

export async function POST(req: Request): Promise<Response> {
  return getHandler()(req);
}
