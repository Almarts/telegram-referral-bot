import { getDb } from "@/db/client";
import { invoices, subscriptionPlans } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getTron } from "@/lib/tron";

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
  depositAddress: string;
  derivIndex: number;
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

/** List all active subscription plans, ordered by id. */
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
 *
 * 1. Validates params (userId required).
 * 2. Looks up the plan — throws if missing or inactive.
 * 3. Gets the next `deriv_index` from the DB sequence.
 * 4. Derives a deposit address from the TRON HD wallet at that index.
 * 5. Inserts the invoice row with a 30-minute expiry.
 *
 * @throws {Error} if userId is empty, plan not found, or plan is inactive.
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  if (!params.userId) {
    throw new Error("userId is required");
  }

  const db = getDb();
  const tron = getTron();

  // 1. Lookup plan
  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, params.planId))
    .limit(1);

  if (!plan || !plan.active) {
    throw new Error(`Plan ${params.planId} not found or inactive`);
  }

  // 2. Get next deriv_index from the sequence
  const [seqRow] = await db
    .select({ nextVal: sql<number>`nextval('deriv_index_seq')` })
    .from(sql`(SELECT 1) AS dummy`);
  const derivIndex = Number(seqRow.nextVal);

  // 3. Derive deposit address
  const { address } = tron.deriveDepositAddress(derivIndex);

  // 4. Insert invoice (30-minute expiry)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const [invoice] = await db
    .insert(invoices)
    .values({
      userId: params.userId,
      planId: params.planId,
      depositAddress: address,
      derivIndex,
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
    depositAddress: invoice.depositAddress!,
    derivIndex: invoice.derivIndex,
    amountUsdt: invoice.amountUsdt,
    expiresAt: invoice.expiresAt,
  };
}
