import { getBot } from "@/bot/bot";
import { getDb } from "@/db/client";
import { campaigns, campaignJoins, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getEnv } from "@/lib/env";

// ── Constants ────────────────────────────────────────────────────────────────

export const CAMPAIGN_FREE_DAYS = 90;
export const CAMPAIGN_LINK_TTL_DAYS = 14;

/** Prefix of every campaign invite link name created by this module. */
const LINK_NAME_PREFIX = "CAMP:";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  slug: string;
  inviteLink: string;
  inviteName: string;
  freeDays: number;
  expiresAt: Date;
  ownerRefCode: string;
  active: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build the invite-link name that encodes the campaign slug (max 32 chars). */
export function campaignInviteName(slug: string): string {
  return `${LINK_NAME_PREFIX}${slug}`.slice(0, 32);
}

/** Extract the campaign slug from an invite-link name, or null if not a campaign link. */
export function slugFromInviteName(name: string | undefined | null): string | null {
  if (!name || !name.startsWith(LINK_NAME_PREFIX)) return null;
  const slug = name.slice(LINK_NAME_PREFIX.length);
  return slug.length > 0 ? slug : null;
}

/** Random URL-safe slug (no ambiguous chars, matches the invite-name charset). */
export function genCampaignSlug(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) s += charset[bytes[i] % charset.length];
  return s;
}

// ── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Find an active campaign whose invite link matches `inviteLink`.
 * Returns null when the link is not a campaign link (or the campaign is off/expired).
 */
export async function findCampaignByInviteLink(
  inviteLink: string,
): Promise<CampaignRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.inviteLink, inviteLink))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!row.active) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/**
 * Find an active campaign by its slug (used as the /start payload of the
 * bot deep link: t.me/<bot>?start=<slug>).
 */
export async function findCampaignBySlug(
  slug: string,
): Promise<CampaignRow | null> {
  if (!slug || slug.length > 40) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!row.active) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/**
 * Resolve the bot deep link a campaign should be shared as.
 * The campaign slug doubles as the /start payload — Telegram delivers it as
 * ctx.match on /start, which lets us bind the referral with zero ambiguity.
 */
export function campaignBotLink(botUsername: string, slug: string): string {
  return `https://t.me/${botUsername}?start=${slug}`;
}

// ── Creation (admin) ─────────────────────────────────────────────────────────

export interface CreateCampaignParams {
  /** Admin telegram id — becomes the referral parent for every joiner. */
  ownerTgUserId: bigint;
  freeDays?: number;
  linkTtlDays?: number;
}

/**
 * Create a reusable, multi-use channel invite link valid for `linkTtlDays`,
 * owned by the given admin. Everyone who follows it gets `freeDays` of free
 * access and is attributed as that admin's referral.
 */
export async function createCampaign(
  params: CreateCampaignParams,
): Promise<CampaignRow> {
  const db = getDb();
  const bot = getBot();
  const channelId = getEnv().DEFAULT_CHANNEL_ID;

  const freeDays = params.freeDays ?? CAMPAIGN_FREE_DAYS;
  const ttlDays = params.linkTtlDays ?? CAMPAIGN_LINK_TTL_DAYS;

  // Owner must exist as a user row so joiners can point at their ref_code.
  const owner = await db
    .select({ id: users.id, refCode: users.refCode })
    .from(users)
    .where(eq(users.tgUserId, params.ownerTgUserId))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!owner) {
    throw new Error(
      "Owner has no user row yet — send /start to the bot once, then retry.",
    );
  }
  if (!owner.refCode) {
    throw new Error("Owner has no ref_code — send /start to the bot once, then retry.");
  }

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const slug = genCampaignSlug();

  const invite = await bot.api.createChatInviteLink(Number(channelId), {
    name: campaignInviteName(slug),
    expire_date: Math.floor(expiresAt.getTime() / 1000),
    creates_join_request: true,
  });

  const [row] = await db
    .insert(campaigns)
    .values({
      slug,
      inviteLink: invite.invite_link,
      inviteName: campaignInviteName(slug),
      freeDays,
      expiresAt,
      ownerRefCode: owner.refCode,
      ownerUserId: owner.id,
      active: true,
    })
    .returning();

  return row;
}

/** Revoke a campaign's invite link and mark it inactive. */
export async function revokeCampaign(slug: string): Promise<boolean> {
  const db = getDb();
  const bot = getBot();
  const channelId = getEnv().DEFAULT_CHANNEL_ID;

  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return false;

  try {
    await bot.api.revokeChatInviteLink(Number(channelId), row.inviteLink);
  } catch (err) {
    console.error("revokeCampaign: revoke failed:", err);
  }

  await db.update(campaigns).set({ active: false }).where(eq(campaigns.slug, slug));
  return true;
}

/** Mark a campaign join as processed (idempotency guard). */
export async function recordJoin(params: {
  campaignId: string;
  tgUserId: bigint;
  state: string;
  detail?: string;
}): Promise<boolean> {
  const db = getDb();
  const res = await db
    .insert(campaignJoins)
    .values({
      campaignId: params.campaignId,
      tgUserId: params.tgUserId,
      state: params.state,
      detail: params.detail ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return res.length > 0;
}

/** Count joins per campaign. */
export async function campaignJoinCount(campaignId: string): Promise<number> {
  const db = getDb();
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(campaignJoins)
    .where(eq(campaignJoins.campaignId, campaignId))
    .then((x) => x[0]?.c ?? 0);
  return r;
}
