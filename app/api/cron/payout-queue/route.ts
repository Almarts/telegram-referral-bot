import { runCronJob } from "@/lib/cron-route";
import { processPayouts } from "@/lib/payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return runCronJob(req, "payout-queue", 300, () => processPayouts());
}
