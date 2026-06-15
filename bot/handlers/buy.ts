import type { Context } from "grammy";
import { getActivePlans, createInvoice } from "@/bot/services/invoices";
import { getDb } from "@/db/client";
import { users, opsKillSwitch, invoices, subscriptionPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { settleByTxId } from "@/lib/settle";
import { grantChannelAccess } from "@/bot/services/grant";
import { cooldown } from "@/lib/kv";
import { getEnv } from "@/lib/env";
import { formatGrantMessage } from "@/bot/services/grant";
import { getBot } from "@/bot/bot";
import { accrueCommissions } from "@/lib/commissions";

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
 * /buy — show a picker of active subscription plans.
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
 * Handle callback_query "buy:<planId>".
 * Creates an invoice and shows the cold wallet address for payment.
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

    const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;
    const msgLines = [
      `*Plan:* ${invoice.planName}`,
      `*Amount:* ${invoice.amountUsdt} USDT`,
      "",
      `Send exactly ${invoice.amountUsdt} USDT (USDT TRC20) to:`,
      `\`${coldAddress}\``,
      "",
      `Expires: ${invoice.expiresAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
      "",
      "After sending, send me the TXID (transaction hash).",
      "",
      "Example: `/settle a1b2c3d4e5f6...`",
      "Or just paste the TXID here.",
    ];
    const msgText = msgLines.join("\n");

    await ctx.reply(msgText, {
      parse_mode: "Markdown",
    }).catch(async (err) => {
      console.error("handleBuyCallback: Markdown reply failed:", err.message);
      await ctx.reply(msgText.replace(/[*`]/g, ""));
    });

    await ctx.answerCallbackQuery({ text: "Invoice created. Send the TXID after payment." });
  } catch (err) {
    console.error("handleBuyCallback:", err);
    ctx.answerCallbackQuery({ text: "Failed to create invoice. Try again." }).catch(() => {});
  }
}

/**
 * Handle TXID submitted by user — verify and settle.
 * Called when user pastes a TXID as text.
 */
export async function handleTxid(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const text = ctx.message?.text ?? "";
  const txId = text.trim();

  // Validate TXID format (TRON tx hashes are 64 hex chars)
  if (!/^[0-9a-fA-F]{64}$/.test(txId)) {
    // Not a TXID — silently ignore
    return;
  }

  const db = getDb();
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) return;

  // Find the user's most recent open invoice
  const inv = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.userId, user.id), eq(invoices.status, "open")))
    .orderBy(invoices.createdAt, "desc")
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!inv) {
    await ctx.reply("You don't have any pending invoices. Use /buy first.");
    return;
  }

  await ctx.reply("Verifying payment...");

  try {
    const result = await settleByTxId(inv.id, txId);

    if (result.settled) {
      await ctx.reply("✅ Payment confirmed! You should receive an invite link shortly.");

      // Send invite link
      if (result.userId && result.planName) {
        const bot = getBot();
        const channelId = getEnv().DEFAULT_CHANNEL_ID;
        const invite = await bot.api.createChatInviteLink(Number(channelId), {
          member_limit: 1,
          expire_date: Math.floor(Date.now() / 1000) + 3600,
        });

        // Grant access
        await grantChannelAccess({
          userId: result.userId,
          planName: result.planName,
        }).catch((err) => console.error("grant:", err));

        // Accrue commissions
        await accrueCommissions(result.invoiceId).catch((err) =>
          console.error("commissions:", err),
        );

        await bot.api.sendMessage(
          Number(tgUser.id),
          formatGrantMessage({ inviteLink: invite.invite_link, planName: result.planName }),
          { parse_mode: "Markdown" },
        ).catch(async (err) => {
          console.error("invite DM failed:", err.message);
          await bot.api.sendMessage(
            Number(tgUser.id),
            formatGrantMessage({ inviteLink: invite.invite_link, planName: result.planName }).replace(/\*/g, ""),
          );
        });
      }
    } else if (result.underpayment) {
      await ctx.reply(
        "We detected the transaction but the amount is less than required. Please send the full amount.",
      );
    } else {
      await ctx.reply(
        "Transaction not found or not yet confirmed on the blockchain. " +
        "Make sure you sent USDT TRC20 to the correct address and try again in a few minutes.",
      );
    }
  } catch (err) {
    console.error("handleTxid:", err);
    await ctx.reply("Something went wrong verifying your payment. Please try again.");
  }
}
