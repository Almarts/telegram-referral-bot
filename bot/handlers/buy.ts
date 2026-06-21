import type { Context } from "grammy";
import { getActivePlans, createInvoice } from "@/bot/services/invoices";
import { getDb } from "@/db/client";
import { users, opsKillSwitch, invoices, subscriptionPlans } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
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

/** Format expiresAt with user's UTC offset */
function formatExpiry(expiresAt: Date, utcOffset: number | null): string {
  const offset = utcOffset ?? 0;
  const local = new Date(expiresAt.getTime() + offset * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = pad(local.getUTCHours());
  const m = pad(local.getUTCMinutes());
  const d = pad(local.getUTCDate());
  const mo = pad(local.getUTCMonth() + 1);
  const y = local.getUTCFullYear();
  const sign = offset >= 0 ? "+" : "";
  const tzH = Math.floor(Math.abs(offset) / 60);
  const tzM = Math.abs(offset) % 60;
  return `${d}.${mo}.${y} ${h}:${m} (UTC${sign}${tzH}:${String(tzM).padStart(2, "0")})`;
}

/**
 * /buy — сразу создаёт инвойс с единственным активным планом.
 */
export async function handleBuy(ctx: Context): Promise<void> {
  if (await isBuyDisabled()) {
    await ctx.reply("🛒 Покупки временно приостановлены. Попробуйте позже.");
    return;
  }

  let plans;
  try {
    plans = await getActivePlans();
  } catch (err) {
    console.error("getActivePlans error:", err);
    await ctx.reply("❌ Что-то пошло не так. Попробуйте позже.");
    return;
  }

  if (plans.length === 0) {
    await ctx.reply("❌ Нет доступных тарифов. Попробуйте позже.");
    return;
  }

  // Use the first (only) active plan
  const plan = plans[0];

  const tgUser = ctx.from;
  if (!tgUser) {
    await ctx.reply("❌ Не удалось определить пользователя.");
    return;
  }

  const db = getDb();
  const user = await db
    .select({ id: users.id, utcOffset: users.utcOffset })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await ctx.reply("Пожалуйста, сначала запустите /start");
    return;
  }

  const rateOk = await cooldown(`rate:invoice:${tgUser.id}`, INVOICE_COOLDOWN_S);
  if (!rateOk) {
    await ctx.reply(`⏳ Подождите ${INVOICE_COOLDOWN_S} секунд между запросами.`);
    return;
  }

  try {
    const invoice = await createInvoice({ userId: user.id, planId: plan.id });
    const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;
    const expiryStr = formatExpiry(invoice.expiresAt, user.utcOffset);

    const msgLines = [
      `📋 *Счёт на оплату*`,
      ``,
      `📌 Тариф: *${invoice.planName}*`,
      `💵 Сумма: *${invoice.amountUsdt} ${invoice.currency}*`,
      ``,
      `Отправьте ровно *${invoice.amountUsdt} ${invoice.currency}* на кошелёк:`,
      `\`${coldAddress}\``,
      ``,
      `⏳ Действителен до: ${expiryStr}`,
      ``,
      `После отправки пришлите мне TXID (хэш транзакции).`,
      `Просто вставьте его сюда в чат.`,
    ];
    const msgText = msgLines.join("\n");

    await ctx.reply(msgText, {
      parse_mode: "Markdown",
    }).catch(async (err) => {
      console.error("handleBuyCallback: Markdown reply failed:", err.message);
      await ctx.reply(msgText.replace(/[*`]/g, ""));
    });

  } catch (err) {
    console.error("handleBuy:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack?.slice(0, 1000) ?? null : null;
    // Log to DB for debugging
    try {
      const db = getDb();
      await db.execute(
        sql`INSERT INTO error_log (message, stack, user_id) VALUES (${errMsg}, ${errStack}, ${tgUser?.id ?? null})`
      );
    } catch {}
    ctx.reply(`❌ Ошибка: ${errMsg}`).catch(() => {});
  }
}

/**
 * Handle callback_query "buy:<planId>" — legacy, kept for renew.
 * Creates an invoice and shows the cold wallet address for payment.
 */
export async function handleBuyCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("buy:")) return;

  const planId = parseInt(data.split(":")[1], 10);
  if (isNaN(planId)) {
    await ctx.answerCallbackQuery({ text: "Неверный тариф." });
    return;
  }

  if (await isBuyDisabled()) {
    await ctx.answerCallbackQuery({ text: "🛒 Покупки временно приостановлены." });
    return;
  }

  const tgUser = ctx.from;
  if (!tgUser) {
    await ctx.answerCallbackQuery({ text: "Не удалось определить пользователя." });
    return;
  }

  const db = getDb();

  const user = await db
    .select({ id: users.id, utcOffset: users.utcOffset })
    .from(users)
    .where(eq(users.tgUserId, BigInt(tgUser.id)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!user) {
    await ctx.answerCallbackQuery({ text: "Сначала запустите /start" });
    return;
  }

  const rateOk = await cooldown(`rate:invoice:${tgUser.id}`, INVOICE_COOLDOWN_S);
  if (!rateOk) {
    await ctx.answerCallbackQuery({ text: `⏳ Подождите ${INVOICE_COOLDOWN_S} секунд.` });
    return;
  }

  try {
    const invoice = await createInvoice({ userId: user.id, planId });
    const coldAddress = getEnv().TRON_COLD_WALLET_ADDRESS;
    const expiryStr = formatExpiry(invoice.expiresAt, user.utcOffset);

    const msgLines = [
      `📋 *Счёт на оплату*`,
      ``,
      `📌 Тариф: *${invoice.planName}*`,
      `💵 Сумма: *${invoice.amountUsdt} ${invoice.currency}*`,
      ``,
      `Отправьте ровно *${invoice.amountUsdt} ${invoice.currency}* на кошелёк:`,
      `\`${coldAddress}\``,
      ``,
      `⏳ Действителен до: ${expiryStr}`,
      ``,
      `После отправки пришлите мне TXID (хэш транзакции).`,
      `Просто вставьте его сюда в чат.`,
    ];
    const msgText = msgLines.join("\n");

    await ctx.reply(msgText, {
      parse_mode: "Markdown",
    }).catch(async (err) => {
      console.error("handleBuyCallback: Markdown reply failed:", err.message);
      await ctx.reply(msgText.replace(/[*`]/g, ""));
    });

    await ctx.answerCallbackQuery({ text: "✅ Счёт создан. После оплаты пришлите TXID." });
  } catch (err) {
    console.error("handleBuyCallback:", err);
    ctx.answerCallbackQuery({ text: "❌ Ошибка создания счёта." }).catch(() => {});
  }
}

/**
 * Handle TXID submitted by user — verify and settle.
 */
export async function handleTxid(ctx: Context): Promise<void> {
  const tgUser = ctx.from;
  if (!tgUser) return;

  const text = ctx.message?.text ?? "";
  const txId = text.trim();

  // Validate TXID format (TRON tx hashes are 64 hex chars)
  if (!/^[0-9a-fA-F]{64}$/.test(txId)) {
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
    await ctx.reply("У вас нет ожидающих счетов. Используйте /buy.");
    return;
  }

  await ctx.reply("⏳ Проверяю платёж...");

  try {
    const result = await settleByTxId(inv.id, txId);

    switch (result.status) {
      case "paid":
        await ctx.reply("✅ Платёж подтверждён! Ссылка-приглашение уже в пути.");

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
        break;

      case "underpaid":
        await ctx.reply("⚠️ Мы нашли транзакцию, но сумма меньше требуемой (10 TRX). Пожалуйста, отправьте полную сумму.");
        break;

      case "not_found":
        await ctx.reply("❌ Транзакция не найдена в блокчейне. Убедитесь, что вы указали правильный TXID, и попробуйте ещё раз.");
        break;

      case "wrong_address":
        await ctx.reply("❌ Транзакция отправлена не на тот адрес. Убедитесь, что отправляете TRX на указанный кошелёк.");
        break;

      case "too_old":
        await ctx.reply("❌ Этот TXID от более старой транзакции. Пожалуйста, отправьте новую оплату и пришлите свежий TXID.");
        break;

      case "duplicate_txid":
        await ctx.reply("❌ Этот TXID уже был использован ранее.");
        break;

      default:
        await ctx.reply("❌ Не удалось проверить платёж. Попробуйте ещё раз.");
    }
  } catch (err) {
    console.error("handleTxid:", err);
    await ctx.reply("❌ Ошибка при проверке платежа. Попробуйте ещё раз.");
  }
}
