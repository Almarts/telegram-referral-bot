import { getDb } from "@/db/client";
import { opsKillSwitch } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/api-auth";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  buyDisabled: z.boolean().optional(),
  payoutDisabled: z.boolean().optional(),
  reason: z.string().max(200).optional(),
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
  if (typeof body.data.buyDisabled === "boolean") data.buyDisabled = body.data.buyDisabled;
  if (typeof body.data.payoutDisabled === "boolean") data.payoutDisabled = body.data.payoutDisabled;
  if (body.data.reason) data.reason = body.data.reason;

  await db.update(opsKillSwitch).set(data).where(eq(opsKillSwitch.id, 1));

  return Response.json({ ok: true });
}
