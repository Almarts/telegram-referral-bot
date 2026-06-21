import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Simple auth check
    const authHeader = request.headers.get("x-admin-secret");
    if (authHeader !== env.ADMIN_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sql, params } = body;
    if (!sql || typeof sql !== "string") {
      return NextResponse.json({ error: "sql field required" }, { status: 400 });
    }

    const sqlClient = neon(env.DATABASE_URL);
    const result = await sqlClient(sql, params ?? []);
    return NextResponse.json({ rows: result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
