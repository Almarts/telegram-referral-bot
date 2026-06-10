/**
 * PAYOUT APPROVAL GATE
 *
 * Holds pending payouts in memory, sends a confirmation request to the admin
 * via Telegram, and awaits an explicit approve / reject callback before
 * executing the USDT transfer.
 *
 * Because this runs in serverless (Vercel), the in-memory Map is ephemeral.
 * If a payout is requested and the bot cold-starts before the admin responds,
 * the pending entry is lost. The cron will simply re-create it on the next
 * tick — no funds are at risk (no USDT sent without approval).
 */

import type { Bot, Context } from "grammy";
import type { TronService, Signer } from "@/lib/tron/types";
import { getEnv } from "@/lib/env";
import { getDb } from "@/db/client";
import { payoutBatches, commissionLedger } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PendingPayout {
  id: string;
  beneficiaryId: string;
  toAddress: string;
  amountUsdt: string;
  batchId: string;
  createdAt: number;
  resolve: (ok: boolean) => void;
}

// ── In-memory store ────────────────────────────────────────────────────────

const pending = new Map<string, PendingPayout>();

/** Get all pending payouts (used for status display). */
export function getPendingPayouts(): PendingPayout[] {
  return Array.from(pending.values());
}

// ── Request flow ───────────────────────────────────────────────────────────

/**
 * Request approval for a payout.
 *
 * 1. Creates a pending entry in the in-memory store.
 * 2. Sends a message to the first admin with inline buttons.
 * 3. Returns a promise that resolves when admin clicks Approve / Reject.
 *
 * The promise has a **120-second timeout**. If the admin doesn't respond in
 * time, the payout is considered rejected (entry removed, promise resolves
 * false). The cron will retry on the next tick (every 30 min).
 */
export function requestPayoutApproval(params: {
  bot: Bot<Context>;
  beneficiaryId: string;
  toAddress: string;
  amountUsdt: string;
  batchId: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `pay_${params.batchId.slice(0, 8)}_${Date.now()}`;

    const entry: PendingPayout = {
      id,
      beneficiaryId: params.beneficiaryId,
      toAddress: params.toAddress,
      amountUsdt: params.amountUsdt,
      batchId: params.batchId,
      createdAt: Date.now(),
      resolve,
    };

    pending.set(id, entry);

    const adminIds = getEnv().ADMIN_TG_IDS;
    const firstAdmin = adminIds[0];
    if (!firstAdmin) {
      pending.delete(id);
      resolve(false);
      return;
    }

    const message = [
      `🔔 *Payout approval required*`,
      ``,
      `Amount: ${params.amountUsdt} USDT`,
      `To: \`${params.toAddress}\``,
      `Batch: \`${params.batchId.slice(0, 8)}\``,
      ``,
      `Approve or reject within 2 minutes — otherwise auto-rejected.`,
    ].join("\n");

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "✅ Approve",
            callback_data: `approve:${id}`,
          },
          {
            text: "❌ Reject",
            callback_data: `reject:${id}`,
          },
        ],
      ],
    };

    params.bot.api
      .sendMessage(Number(firstAdmin), message, {
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      })
      .catch((err) => {
        console.error(`payout-approval: failed to send to admin:`, err);
        pending.delete(id);
        resolve(false);
      });

    // Auto-reject after 120 seconds
    setTimeout(() => {
      const existing = pending.get(id);
      if (existing) {
        pending.delete(id);
        params.bot.api
          .sendMessage(
            Number(firstAdmin),
            `⏰ *Payout auto-rejected* (timeout)\nAmount: ${params.amountUsdt} USDT\nBatch: \`${params.batchId.slice(0, 8)}\``,
            { parse_mode: "Markdown" },
          )
          .catch(() => {});
        resolve(false);
      }
    }, 120_000);
  });
}

// ── Admin callback handler ─────────────────────────────────────────────────

/**
 * Handle an approve/reject callback from the admin.
 * Returns true if the callback data was recognised and processed.
 */
export async function handlePayoutCallback(
  ctx: Context,
  bot: Bot<Context>,
  tron: TronService,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data ?? "";
  const tgUserId = ctx.from?.id;
  if (!tgUserId) return false;

  const adminIds = getEnv().ADMIN_TG_IDS;
  if (!adminIds.includes(BigInt(tgUserId))) return false;

  let action: "approve" | "reject" | null = null;
  let id = "";

  if (data.startsWith("approve:")) {
    action = "approve";
    id = data.slice(8);
  } else if (data.startsWith("reject:")) {
    action = "reject";
    id = data.slice(7);
  }

  if (!action || !id) return false;

  const entry = pending.get(id);
  if (!entry) {
    await ctx.answerCallbackQuery({
      text: "This payout is no longer pending (already processed or expired).",
      show_alert: true,
    });
    return true;
  }

  pending.delete(id);

  if (action === "reject") {
    entry.resolve(false);
    await ctx.answerCallbackQuery({ text: "❌ Payout rejected." });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    return true;
  }

  // ── Approve: execute the transfer ────────────────────────────────────
  await ctx.answerCallbackQuery({ text: "⏳ Sending USDT…" });

  try {
    const { txHash } = await tron.sendUsdt({
      fromAddress: tron.hotSigner().address,
      toAddress: entry.toAddress,
      amount: entry.amountUsdt,
      signer: tron.hotSigner(),
    });

    // Mark batch as broadcast
    await getDb()
      .update(payoutBatches)
      .set({ txHash, status: "broadcast", broadcastAt: new Date() })
      .where(eq(payoutBatches.id, entry.batchId));

    // Mark commission ledger rows as paid
    await getDb()
      .update(commissionLedger)
      .set({ status: "paid", batchId: entry.batchId, paidTxHash: txHash })
      .where(
        and(
          eq(commissionLedger.beneficiaryId, entry.beneficiaryId),
          eq(commissionLedger.status, "payable"),
        ),
      );

    entry.resolve(true);

    await ctx.editMessageText(
      [
        `✅ *Payout approved and sent\!*`,
        ``,
        `Amount: ${entry.amountUsdt} USDT`,
        `To: \`${entry.toAddress}\``,
        `Tx: \`${txHash.slice(0, 16)}…\``,
      ].join("\n"),
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    entry.resolve(false);
    const msg = String(err).slice(0, 200);
    await ctx.editMessageText(
      [
        `❌ *Payout failed\!*`,
        ``,
        `Amount: ${entry.amountUsdt} USDT`,
        `To: \`${entry.toAddress}\``,
        `Error: \`${msg}\``,
      ].join("\n"),
      { parse_mode: "MarkdownV2" },
    );
  }

  return true;
}
