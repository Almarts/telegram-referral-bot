import { runCronJob } from "@/lib/cron-route";
import { processNudges, processExpiries } from "@/lib/expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return runCronJob(req, "expire-access", 90, async () => {
    const nudges = await processNudges();
    const expired = await processExpiries();
    return { nudges, expired };
  });
}
