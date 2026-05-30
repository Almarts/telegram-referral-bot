import { genRefCode, createUniqueRefCode } from "@/lib/refcode";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// ── Pure logic (independently testable, no DB) ──────────────────────────────

export interface ExistingUser {
  id: string;
  tgUserId: bigint;
  refCode: string | null;
  parentRefCode: string | null;
}

export interface Referrer {
  id: string;
  refCode: string;
}

export interface OnboardInput {
  existingUser: ExistingUser | null;
  startPayload: string | undefined;
  /** The user whose ref_code matches startPayload, or null if none found. */
  refByPayload: Referrer | null;
  /** The user's own current ref_code (or null). */
  ownRefCode: string | null;
}

export interface OnboardResult {
  action: "created" | "existing";
  parentRefCode: string | null;
  refCode: string | null;
}

/**
 * Pure function that computes what should happen when a user starts the bot.
 *
 * - New user with valid referral → parent assigned.
 * - Existing user → parent locked forever (no override).
 * - Self-referral → ignored.
 * - User without a ref_code yet → one generated.
 *
 * Collision-checking for generated ref codes is the caller's responsibility
 * (handled inside {@link onboardUser} via the DB).
 */
export function onboardLogic(input: OnboardInput): OnboardResult {
  const isNew = !input.existingUser;
  const parentRefCode = resolveParentRef(input);
  const refCode = resolveRefCode(input);

  return {
    action: isNew ? "created" : "existing",
    parentRefCode,
    refCode,
  };
}

function resolveParentRef(input: OnboardInput): string | null {
  // Existing user with a parent → locked forever
  if (input.existingUser?.parentRefCode) {
    return input.existingUser.parentRefCode;
  }
  // No payload or no matching referrer → no parent
  if (!input.startPayload || !input.refByPayload) return null;
  // Self-referral → ignore
  if (input.refByPayload.id === input.existingUser?.id) return null;
  return input.refByPayload.refCode;
}

function resolveRefCode(input: OnboardInput): string | null {
  // Already has a ref code → keep it
  if (input.existingUser?.refCode) return input.existingUser.refCode;
  // Generate a new one (collision retry done by the caller via createUniqueRefCode)
  return genRefCode();
}

// ── DB wrapper ──────────────────────────────────────────────────────────────

/**
 * Upsert a Telegram user into the `users` table using individual queries
 * (neon-http driver does not support transactions).
 *
 * 1. Try an upsert with `onConflictDoNothing` — if the user already exists
 *    this is a no-op and returns an empty array.
 * 2. **New user** — resolve parent ref from `startPayload`, generate a unique
 *    `refCode`, then update the row.
 * 3. **Existing user without a refCode** — generate one (catch-up for legacy
 *    rows). Existing users never have `parentRefCode` changed.
 *
 * Concurrency safety comes from UNIQUE constraints on `tg_user_id` and
 * `ref_code` + the `createUniqueRefCode` retry loop.
 */
export async function onboardUser(params: {
  tgUserId: bigint;
  tgUsername?: string;
  tgLang?: string;
  startPayload?: string;
}): Promise<void> {
  const db = getDb();

  // 1. Try upsert — if the user already exists this is a no-op and returns nothing.
  // We DON'T insert ref_code or parent_ref_code yet — we need to check collisions first.
  const inserted = await db
    .insert(users)
    .values({
      tgUserId: params.tgUserId,
      tgUsername: params.tgUsername ?? null,
      tgLang: params.tgLang ?? null,
      refCode: null,
      parentRefCode: null,
    })
    .onConflictDoNothing()
    .returning();

  const isNew = inserted.length > 0;

  if (isNew) {
    // New user — resolve parent ref
    let parentRefCode: string | null = null;
    if (params.startPayload) {
      const referrer = await db
        .select({ id: users.id, refCode: users.refCode })
        .from(users)
        .where(eq(users.refCode, params.startPayload))
        .limit(1)
        .then((r) => r[0] ?? null);

      // Self-referral guard: can't be your own parent
      if (referrer && referrer.id !== inserted[0].id) {
        parentRefCode = referrer.refCode;
      }
    }

    // Generate unique ref code
    const refCode = await createUniqueRefCode(async (candidate) => {
      const dupe = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.refCode, candidate))
        .limit(1);
      return dupe.length === 0;
    });

    // Update the newly inserted row
    await db
      .update(users)
      .set({ refCode, parentRefCode })
      .where(eq(users.tgUserId, params.tgUserId));
  } else {
    // Existing user — check if ref_code is missing (catch-up)
    const existing = await db
      .select({ id: users.id, refCode: users.refCode })
      .from(users)
      .where(eq(users.tgUserId, params.tgUserId))
      .limit(1)
      .then((r) => r[0]!);

    if (!existing.refCode) {
      const refCode = await createUniqueRefCode(async (candidate) => {
        const dupe = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.refCode, candidate))
          .limit(1);
        return dupe.length === 0;
      });

      await db
        .update(users)
        .set({ refCode })
        .where(eq(users.id, existing.id));
    }
  }
}
