import { processSweeps } from "@/lib/sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const result = await processSweeps();
  return new Response(
    JSON.stringify({ swept: result }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
