/**
 * TEMPORARY: manually trigger payout processing.
 * DELETE AFTER USE.
 */
import { processPayouts } from "@/lib/payouts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const result = await processPayouts();
  return Response.json(result);
}
