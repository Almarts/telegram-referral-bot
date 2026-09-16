// Diagnostic webhook: logs any incoming update so we can see what Telegram sends
// when a user follows an invite link (chat_join_request vs chat_member vs message).
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const token = getEnv().TELEGRAM_BOT_TOKEN;
  try {
    const body = await req.text();

    // Mode "flush": read and discard the accumulated getUpdates buffer.
    if (req.headers.get("x-diag-mode") === "flush") {
      const cur = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const info = (await cur.json()) as { result?: { pending_update_count?: number } };
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=-1&timeout=1`);
      const updates = await r.text();
      return Response.json({ webhookInfo: info, updates });
    }

    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage?chat_id=607645943&text=${encodeURIComponent(
        "DIAG " + body.slice(0, 1500),
      )}`,
    );
  } catch (e) {
    void e;
  }
  return new Response("ok");
}
