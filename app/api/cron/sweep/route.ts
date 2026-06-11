import { processSweeps } from "@/lib/sweep";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  // CRON_SECRET check
  const auth = req.headers.get("authorization") ?? "";
  const expected = "Bearer " + getEnv().CRON_SECRET;
  if (auth !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const swept = await processSweeps();
  return Response.json({ swept });
}
