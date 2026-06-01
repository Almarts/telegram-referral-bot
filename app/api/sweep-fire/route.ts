import { processSweeps } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 
 * WARNING: No auth — ephemeral debug only.
 */
export async function GET(): Promise<Response> {
  const swept = await processSweeps();
  return Response.json({ swept, ts: new Date().toISOString() });
}
