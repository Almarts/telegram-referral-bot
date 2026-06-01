import { processSweeps } from "@/lib/sweep";
import { requireCronAuth } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!requireCronAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const swept = await processSweeps();
  return Response.json({ swept });
}
