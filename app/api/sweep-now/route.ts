import { processSweeps } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const result = await processSweeps();
  return Response.json({ swept: result });
}
