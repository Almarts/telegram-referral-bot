import type { Context } from "grammy";
import { getPendingPayouts } from "@/lib/payout-approval";
import { adminOnly } from "@/bot/middleware/admin_only";
import { getBot } from "@/bot/bot";

const bot = getBot();

bot.command("payouts", adminOnly, async (ctx: Context) => {
  const list = getPendingPayouts();

  if (list.length === 0) {
    await ctx.reply("No pending payouts right now.", { parse_mode: "Markdown" });
    return;
  }

  const lines = list.map(
    (p, i) =>
      `${i + 1}\\. \`${p.id}\` — ${p.amountUsdt} USDT → \`${p.toAddress.slice(0, 8)}…\` (${Math.floor((Date.now() - p.createdAt) / 1000)}s ago)`,
  );

  await ctx.reply(
    [
      `*Pending payouts:* ${list.length}`,
      ``,
      ...lines,
    ].join("\n"),
    { parse_mode: "MarkdownV2" },
  );
});
