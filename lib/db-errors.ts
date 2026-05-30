/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/**
 * True if the error is a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used for idempotency: an insert that races a duplicate is a no-op, not a fault.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
