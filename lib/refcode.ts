// Crockford's base32: 0-9, A-H, J-K, M-N, P-T, V-Z (excludes I, L, O, U)
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;
const DEFAULT_MAX_ATTEMPTS = 8;

/** Generate a single random 6-char ref code (Crockford base32). */
export function genRefCode(): string {
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CROCKFORD[bytes[i] % CROCKFORD.length];
  }
  return code;
}

/** Generate a ref code, retrying against a provided async collision check. */
export async function createUniqueRefCode(
  tryInsert: (code: string) => Promise<boolean>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = genRefCode();
    const ok = await tryInsert(code);
    if (ok) return code;
  }
  throw new Error(`Failed to generate unique ref code after ${maxAttempts} attempts`);
}
