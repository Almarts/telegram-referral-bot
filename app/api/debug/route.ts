import { getLastBotError } from "@/app/api/tg/webhook/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const err = getLastBotError();
  return new Response(
    JSON.stringify({ lastBotError: err, hasError: err !== null }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
