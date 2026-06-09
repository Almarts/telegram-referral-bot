import type { Context } from "grammy";

/**
 * Send a message with Markdown formatting.
 * Falls back to plain text if Markdown parsing fails.
 */
export async function safeReply(
  ctx: Context,
  text: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.reply(text, { ...extra, parse_mode: "Markdown" });
  } catch (e: unknown) {
    console.error("safeReply: Markdown parse failed, falling back to plain text", e instanceof Error ? e.message : String(e));
    try {
      // Strip any Markdown characters for plain text fallback
      const plain = text
        .replace(/\*{1,2}/g, "")
        .replace(/_{1,2}/g, "")
        .replace(/`{1,3}/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      await ctx.reply(plain);
    } catch (e2) {
      console.error("safeReply fallback also failed:", e2);
    }
  }
}
