import type { Context } from "grammy";
import { getActivePlans, createInvoice } from "@/bot/services/invoices";
import { getDb } from "@/db/client";
import { users, opsKillSwitch } from "@/db/schema";
import { eq } from "drizzle-orm";
import { settleIfPaid } from "@/lib/settle";
import { cooldown } from "@/lib/kv";

const INVOICE_COOLDOWN_S = 30;

async function isBuyDisabled(): Promise<boolean> {
  const db = getDb();
  const ks = await db
    .select({ buyDisabled: opsKillSwitch.buyDisabled })
    .from(opsKillSwitch)
    .limit(1)
    .then((r) => r[0] ?? null);
  return ks?.buyDisabled ?? false;
}

/**
 * /buy — show a picker of active subscription plans as inline keyboard buttons.
 */
export async function handleBuy(ctx: Context): Promise<void> {
  if (await isBuyDisabled()) {
    await ctx.reply("Purchases are temporarily disabled. Please try again later.");
    return;
  }

  let plans;
  try {
    plans = await getActivePlans();
  } catch (err) {
    console.error("getActivePlans error:", err);
    await ctx.reply("Something went wrong. Please try again later.");
    return;
  }

  if (plans.length === 0) {
    await ctx.reply("No plans are currently available. Please try again later.");
    return;
  }

  await ctx.reply("Choose a plan:", {
    reply_markup: {
      inline_keyboard: plans.map((plan) => [
        {
          text: `${plan.name} — ${plan.priceUsdt} USDT (${plan.durationDays} days)`,
          callback_data: `buy:${plan.id}`,
        },
      ]),
    },
  });
}

/**
 * Handle callback_query where data starts with "buy:".
 * Looks up the user and chosen plan, creates an invoice, and replies with
 * the deposit address and payment instructions.
 */
export async function handleBuyCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("buy:")) return;

  const planId = parseInt(data.split(":")[1], 10);
  if (isNaN(planId)) {
    await ctx.answerCallbackQuery({ text: "Invalid plan." });
    return;
  }

  if (await isBuyDisabled()) {
    await ctx.answerCallbackQuery({ text: "Purchases are temporarily disabled." });
    return;
  }

  const tgUser = ctx.from;
  if (!tgUser) {
    await ctx.answerCallbackQuery({ text: "Could not identify user." });
    return;
  }

  const db = getDb();

  // Lookup the user's DB record by Telegram user id
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await ctx.answerCallbackQuery({ text: "Please /start the bot first." });
    return;
  }

  const rateOk = await cooldown(`rate:invoice:${tgUser.id}`, INVOICE_COOLDOWN_S);
  if (!rateOk) {
    await ctx.answerCallbackQuery({ text: `Please wait ${INVOICE_COOLDOWN_S}s between requests.` });
    return;
  }

  try {
    const invoice = await createInvoice({ userId: user.id, planId });

    await ctx.reply(
      [
        `*Plan:* ${invoice.planName}`,
        `*Amount:* ${invoice.amountUsdt} USDT`,
        "",
        `Send exactly *${invoice.amountUsdt} USDT* to:`,
        `\`${invoice.depositAddress}\``,
        "",
        `Expires: ${invoice.expiresAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
        "",
        "After sending, tap _I've paid_.",
      ].join("\n"),
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "I've paid", callback_data: `check:${invoice.id}` }],
          ],
        },
      },
    );

    await ctx.answerCallbackQuery({ text: "Invoice created." });
  } catch (err) {
    console.error("handleBuyCallback:", err);
    ctx.answerCallbackQuery({ text: "Failed to create invoice. Try again." }).catch(() => {});
  }
}

/**
 * Handle the "I've paid" button callback (check:<invoice_id>).
 * Triggers on-demand settlement so users get instant feedback after paying.
 */
export async function handleCheckCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("check:")) return;

  const invoiceId = data.split(":")[1];
  if (!invoiceId) {
    await ctx.answerCallbackQuery({ text: "Invalid invoice." });
    return;
  }

  await ctx.answerCallbackQuery({ text: "Checking payment..." });

  try {
    const result = await settleIfPaid(invoiceId);

    if (result.settled) {
      await ctx.reply("Payment confirmed! You should receive an invite link shortly.");
    } else if (result.underpayment) {
      await ctx.reply(
        "We detected a payment but the amount was less than required. Please send the full amount to complete your purchase.",
      );
    } else {
      await ctx.reply(
        "Payment not yet detected. It may take a moment to confirm on the blockchain. Try again or wait for automatic detection.",
      );
    }
  } catch (err) {
    console.error("handleCheckCallback:", err);
    await ctx.reply("Something went wrong checking your payment. We'll detect it automatically soon.");
  }
}
