import { runCronJob } from "@/lib/cron-route";
import { processSweeps } from "@/lib/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  // 20-min lease (2x the 10-min cron interval) prevents concurrent runs
  // when processSweeps takes longer than the cron schedule.
  return runCronJob(req, "sweep", 1200, async () => ({
    swept: await processSweeps(),
  }));
}
