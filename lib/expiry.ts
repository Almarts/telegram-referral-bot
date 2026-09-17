import { getDb } from "@/db/client";
import { subscriptions, users, nudgesSent } from "@/db/schema";
import { eq, and, lte, sql, inArray, asc } from "drizzle-orm";
import { getBot } from "@/bot/bot";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SubWithUser {
  subId: string;
  userId: string;
  tgUserId: bigint;
  channelId: bigint;
  endsAt: Date;
}

export interface NudgeResult {
  subId: string;
  window: string;
  tgUserId: bigint;
  endsAt: Date;
}

// ── Nudge windows ──────────────────────────────────────────────────────────
// Отправляем напоминания о продлении за 7 дней и за 24 часа до окончания.
//
// ВАЖНО: точное время срабатывания не задаётся здесь. Напоминание уходит на
// первом тике после пересечения отметки T-7d / T-24h, поэтому реальный момент
// зависит только от того, как часто вызывается cron (см. renderTrigger).
const NUDGE_WINDOWS = [
  { label: "7d", msBefore: 7 * 24 * 60 * 60 * 1000 },
  { label: "24h", msBefore: 24 * 60 * 60 * 1000 },
] as const;

/**
 * Окно срабатывания. Подписка попадает в окно W, когда её ends_at находится
 * в диапазоне [now + W, now + W + TICK_INTERVAL_MS).
 *
 * Ширина окна должна покрывать интервал между двумя запусками cron: если она
 * меньше, часть подписок проскочит окно между тиками и напоминание не уйдёт.
 * Значение держим с запасом — лишние попадания отсекает таблица nudges_sent
 * (уникальный ключ sub_id + window).
 */
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 час — реальный интервал cron

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Determine which subscriptions should receive a renewal nudge.
 *
 * A sub qualifies for window W when:
 *   ends_at falls in [now + W, now + W + tick_interval)
 *   AND no nudge for that (sub, window) has been sent yet.
 */
export function computeNudges(
  subs: SubWithUser[],
  sentKeys: Set<string>,
  now: Date,
): NudgeResult[] {
  const nowMs = now.getTime();
  const results: NudgeResult[] = [];

  for (const s of subs) {
    const endsMs = s.endsAt.getTime();

    for (const w of NUDGE_WINDOWS) {
      const windowStart = nowMs + w.msBefore;
      const windowEnd = windowStart + TICK_INTERVAL_MS;

      if (endsMs >= windowStart && endsMs < windowEnd) {
        const key = `${s.subId}:${w.label}`;
        if (!sentKeys.has(key)) {
          results.push({
            subId: s.subId,
            window: w.label,
            tgUserId: s.tgUserId,
            endsAt: s.endsAt,
          });
        }
        break; // only the widest matching window per sub
      }
    }
  }

  return results;
}

/**
 * Determine which subscriptions have expired and need processing.
 */
export function computeExpiries(subs: SubWithUser[], now: Date): SubWithUser[] {
  return subs.filter((s) => s.endsAt.getTime() <= now.getTime());
}

// ── Nudge messages ─────────────────────────────────────────────────────────

function formatNudgeMessage(window: string, endsAt: Date): string {
  const endsStr = endsAt.toISOString().replace("T", " ").slice(0, 16);
  const renewLine =
    "Продлите сейчас, чтобы сохранить доступ: нажмите /buy и выберите тариф.";
  if (window === "7d") {
    return [
      "⏳ Через неделю заканчивается ваша подписка.",
      `Действует до: ${endsStr} UTC`,
      "",
      renewLine,
    ].join("\n");
  }
  // window === "24h"
  return [
    "⏳ Ваша подписка заканчивается уже завтра!",
    `Действует до: ${endsStr} UTC`,
    "",
    renewLine,
  ].join("\n");
}

function formatExpiryMessage(): string {
  return [
    "❌ Ваша подписка истекла, доступ к каналу закрыт.",
    "",
    "Чтобы оплатить доступ снова, нажмите /buy и выберите тариф.",
  ].join("\n");
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Scan active subscriptions and send renewal nudges at T-7d and T-24h.
 *
 * Idempotent via the `nudges_sent` table — each (sub_id, window) pair is
 * recorded and the primary key prevents duplicate sends.
 *
 * Returns the number of nudges sent this tick.
 */
export async function processNudges(): Promise<number> {
  const db = getDb();
  const bot = getBot();
  const now = new Date();

  // Кандидаты: подписки, у которых до конца осталось меньше 8 дней.
  // Реальное решение о напоминании принимает computeNudges — здесь только
  // сужаем выборку, чтобы не тянуть всю таблицу.
  const active = await db
    .select({
      subId: subscriptions.id,
      userId: subscriptions.userId,
      tgUserId: users.tgUserId,
      channelId: subscriptions.channelId,
      endsAt: subscriptions.endsAt,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(
      and(
        eq(subscriptions.status, "active"),
        lte(subscriptions.endsAt, sql`now() + interval '8 days'`),
      ),
    )
    .orderBy(asc(subscriptions.endsAt))
    .limit(200);

  if (active.length === 0) return 0;

  const activeSubIds = active.map((s) => s.subId);

  // Only fetch nudges relevant to the candidate subs (avoids full table scan)
  const existing = await db
    .select({ subId: nudgesSent.subId, window: nudgesSent.window })
    .from(nudgesSent)
    .where(inArray(nudgesSent.subId, activeSubIds));

  const existingKeys = new Set(
    existing.map((n) => `${n.subId}:${n.window}`),
  );

  const toNudge = computeNudges(active, existingKeys, now);
  let sent = 0;

  for (const n of toNudge) {
    try {
      const message = formatNudgeMessage(n.window, n.endsAt);
      await bot.api.sendMessage(Number(n.tgUserId), message);

      await db.insert(nudgesSent).values({
        subId: n.subId,
        window: n.window,
      });
      sent++;
    } catch (err) {
      console.error(`nudge ${n.subId}/${n.window}:`, err);
    }
  }

  return sent;
}

/**
 * Process expired subscriptions: soft-kick (ban+unban), mark as expired, DM user.
 *
 * Each subscription is processed individually — if banChatMember fails
 * permanently (e.g. lost admin rights), the sub is skipped and needs manual
 * intervention. Transient failures are retried on the next tick.
 *
 * Returns the number of subscriptions expired this tick.
 */
export async function processExpiries(): Promise<number> {
  const db = getDb();
  const bot = getBot();
  const now = new Date();

  // Fetch active subscriptions past their ends_at, oldest first
  const expired = await db
    .select({
      subId: subscriptions.id,
      userId: subscriptions.userId,
      tgUserId: users.tgUserId,
      channelId: subscriptions.channelId,
      endsAt: subscriptions.endsAt,
    })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(
      and(
        eq(subscriptions.status, "active"),
        lte(subscriptions.endsAt, now),
      ),
    )
    .orderBy(asc(subscriptions.endsAt))
    .limit(200);

  let processed = 0;

  for (const sub of expired) {
    // Полная блокировка (без авторазбана): юзер не может войти в канал,
    // пока при новой оплате grantChannelAccess не разблокирует его обходом
    // unbanChatMember перед выдачей ссылки-приглашения.
    try {
      // Без until_date Telegram банит навсегда; юзер остаётся заблокированным,
      // пока не оплатит заново, после чего grant.ts разбанит его.
      await bot.api.banChatMember(Number(sub.channelId), Number(sub.tgUserId));
    } catch (err: unknown) {
      const msg = String(err);
      // "not enough rights" — bot lost admin, needs manual intervention
      if (msg.includes("not enough rights")) {
        console.error(
          `expire-access: lost admin in channel ${sub.channelId}, sub=${sub.subId}`,
        );
      } else {
        console.error(`banChatMember failed sub=${sub.subId}:`, msg);
      }
      continue;
    }

    try {
      // Mark as expired — WHERE status='active' guards against double-processing
      const result = await db
        .update(subscriptions)
        .set({ status: "expired" })
        .where(
          and(
            eq(subscriptions.id, sub.subId),
            eq(subscriptions.status, "active"),
          ),
        );

      if (result.rowCount === 0) continue;

      // DM the user (best-effort, user may have blocked the bot)
      try {
        await bot.api.sendMessage(
          Number(sub.tgUserId),
          formatExpiryMessage(),
        );
      } catch {
        // silently skip
      }

      processed++;
    } catch (err) {
      console.error(`expire-access: status update failed sub=${sub.subId}:`, err);
    }
  }

  return processed;
}
