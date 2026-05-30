import { getDb } from "@/db/client";
import { commissionConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/api-auth";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tierSchema = z.object({
  min: z.number().int().min(0),
  bps: z.number().int().min(0).max(10000),
});

const bodySchema = z.object({
  l1Tiers: z.array(tierSchema).min(1).optional(),
  l2Bps: z.number().int().min(0).max(10000).optional(),
  payoutMode: z.enum(["instant", "deferred"]).optional(),
  deferDays: z.number().int().min(0).max(365).optional(),
  minPayoutUsdt: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!requireAdminAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return Response.json({ error: body.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const data: Record<string, unknown> = {};

  if (body.data.l1Tiers) data.l1Tiers = body.data.l1Tiers;
  if (typeof body.data.l2Bps === "number") data.l2Bps = body.data.l2Bps;
  if (body.data.payoutMode) data.payoutMode = body.data.payoutMode;
  if (typeof body.data.deferDays === "number") data.deferDays = body.data.deferDays;
  if (body.data.minPayoutUsdt) data.minPayoutUsdt = body.data.minPayoutUsdt;

  await db.update(commissionConfig).set(data).where(eq(commissionConfig.id, 1));

  return Response.json({ ok: true });
}
