import { getDb } from "@/db/client";
import { invoices, subscriptionPlans } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreateInvoiceParams {
  userId: string;
  planId: number;
}

export interface Invoice {
  id: string;
  userId: string;
  planId: number;
  planName: string;
  currency: string;
  coldAddress: string;
  amountUsdt: string;
  expiresAt: Date;
}

export interface Plan {
  id: number;
  name: string;
  durationDays: number;
  priceUsdt: string;
  active: boolean;
}

// ── Queries ────────────────────────────────────────────────────────────────

export async function getActivePlans(): Promise<Plan[]> {
  const db = getDb();
  return db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.active, true))
    .orderBy(subscriptionPlans.id);
}

/**
 * Create a pending invoice for a user and plan.
 * No unique deposit address — user sends USDT directly to the cold wallet.
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  if (!params.userId) {
    throw new Error("userId is required");
  }

  const db = getDb();

  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, params.planId))
    .limit(1);

  if (!plan || !plan.active) {
    throw new Error(`Plan ${params.planId} not found or inactive`);
  }

  const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const [invoice] = await db
    .insert(invoices)
    .values({
      userId: params.userId,
      planId: params.planId,
      depositAddress: coldAddress,
      derivIndex: 0,
      amountUsdt: plan.priceUsdt,
      status: "open",
      expiresAt,
    })
    .returning();

  return {
    id: invoice.id,
    userId: invoice.userId,
    planId: invoice.planId,
    planName: plan.name,
    currency: plan.currency,
    coldAddress: invoice.depositAddress!,
    amountUsdt: invoice.amountUsdt,
    expiresAt: invoice.expiresAt,
  };
}
