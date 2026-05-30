import { describe, it, expect, vi } from "vitest";
import { createBot } from "./bot";
import { handleStart, MENU_KEYBOARD } from "./handlers/start";
import { mockCtx } from "./test-utils";

// grammY Bot instances are not fully typed on `api` in test contexts;
// check for the token as a proxy for a properly constructed instance.
describe("createBot", () => {
  it("returns a bot instance with a token", () => {
    const bot = createBot("test:token");
    expect(bot).toBeDefined();
    expect(bot.token).toBe("test:token");
    expect(typeof bot.handleUpdate).toBe("function");
  });

  it("returns distinct instances for different tokens", () => {
    const a = createBot("test:aaa");
    const b = createBot("test:bbb");
    expect(a.token).toBe("test:aaa");
    expect(b.token).toBe("test:bbb");
  });
});

describe("handleStart", () => {
  it("includes welcome text and menu options in the reply", async () => {
    const reply = vi.fn();
    const ctx = {
      from: { first_name: "Alice", id: 1, is_bot: false },
      match: null,
      reply,
    };

    await handleStart(mockCtx(ctx));

    expect(reply).toHaveBeenCalledTimes(1);
    const [text, opts] = reply.mock.calls[0];

    // Welcome message
    expect(text).toContain("Welcome, Alice!");
    expect(text).toContain("Choose an option below:");

    // Menu keyboard
    expect(opts?.reply_markup).toEqual(MENU_KEYBOARD);
  });

  it("falls back to 'there' when from is missing", async () => {
    const reply = vi.fn();
    const ctx = {
      from: undefined,
      match: null,
      reply,
    };

    await handleStart(mockCtx(ctx));

    expect(reply).toHaveBeenCalledTimes(1);
    const [text] = reply.mock.calls[0];
    expect(text).toContain("Welcome, there!");
  });
});
