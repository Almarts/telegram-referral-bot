import type { Context } from "grammy";

/**
 * Create a minimal mock Context for handler tests.
 * Accepts a partial object and returns it typed as Context via cast.
 */
export function mockCtx<T extends Record<string, unknown>>(overrides: T = {} as T): Context {
  return overrides as unknown as Context;
}
