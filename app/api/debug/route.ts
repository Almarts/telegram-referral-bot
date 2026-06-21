import { getDb } from "@/db/client";
import { users, subscriptionPlans, invoices, opsKillSwitch } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { cooldown } from "@/lib/kv";
import { getBot } from "@/bot/bot";
import { createInvoice } from "@/bot/services/invoices";
import { getActivePlans } from "@/bot/services/invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

async function isBuyDisabled(): Promise<boolean> {
  const db = getDb();
  const ks = await db
    .select({ buyDisabled: opsKillSwitch.buyDisabled })
    .from(opsKillSwitch)
    .limit(1)
    .then((r) => r[0] ?? null);
  return ks?.buyDisabled ?? false;
}

export async function GET() {
  const issues: string[] = [];
  const TG_USER = 944750077;

  // Simulate handleBuy EXACTLY as in buy.ts
  try {
    // Step 1: kill switch
    const disabled = await isBuyDisabled();
    issues.push(`KILL_SWITCH: ${disabled}`);

    // Step 2: getActivePlans
    const plans = await getActivePlans();
    issues.push(`PLANS: ${plans.length}`);
    if (plans.length > 0) issues.push(`FIRST_PLAN: ${plans[0].name} ${plans[0].priceUsdt} ${plans[0].currency}`);

    // Step 3: find user
    const db = getDb();
    const user = await db
      .select({ id: users.id, utcOffset: users.utcOffset })
      .from(users)
      .where(eq(users.tgUserId, BigInt(TG_USER)))
      .limit(1)
      .then((r) => r[0] ?? null);
    issues.push(`USER: ${user ? user.id : "NOT_FOUND"}`);

    if (user && plans.length > 0) {
      // Step 4: cooldown
      try {
        const rateOk = await cooldown(`rate:invoice:${TG_USER}`, 30);
        issues.push(`COOLDOWN: ${rateOk}`);
      } catch (e: any) {
        issues.push(`COOLDOWN_ERR: ${e.message}`);
      }

      // Step 5: create invoice
      try {
        const invoice = await createInvoice({ userId: user.id, planId: plans[0].id });
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
        ].join("\n");

        // Step 6: send message - Markdown with fallback
        try {
          const bot = getBot();
          await bot.api.sendMessage(TG_USER, msgLines, { parse_mode: "Markdown" });
          issues.push("SEND_OK");
        } catch (e: any) {
          try {
            const bot = getBot();
            await bot.api.sendMessage(TG_USER, msgLines.replace(/[*`]/g, ""));
            issues.push(`SEND_FALLBACK: ${e.message}`);
          } catch (e2: any) {
            issues.push(`SEND_FAILED: ${e.message} | ${e2.message}`);
          }
        }
      } catch (e: any) {
        issues.push(`CREATE_INVOICE_ERR: ${e.message}`);
        if (e.stack) issues.push(`STACK: ${e.stack.slice(0, 300)}`);
      }
    }
  } catch (e: any) {
    issues.push(`FATAL: ${e.message}`);
    if (e.stack) issues.push(`STACK: ${e.stack.slice(0, 300)}`);
  }

  return new Response(JSON.stringify({ status: "ok", issues }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
