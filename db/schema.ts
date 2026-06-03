import {
  pgTable,
  pgEnum,
  uuid,
  bigint,
  text,
  integer,
  smallint,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  pgSequence,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enums ────────────────────────────────────────────────────────────────────

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "open",
  "paid",
  "expired",
  "refunded",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "expired",
  "revoked",
]);

export const commissionStatusEnum = pgEnum("commission_status", [
  "accrued",
  "payable",
  "paid",
  "clawed_back",
]);

export const payoutModeEnum = pgEnum("payout_mode", ["instant", "deferred"]);

export const batchStatusEnum = pgEnum("batch_status", [
  "pending",
  "broadcast",
  "confirmed",
  "failed",
]);

// ── Tables ───────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tgUserId: bigint("tg_user_id", { mode: "bigint" }).notNull().unique(),
    tgUsername: text("tg_username"),
    tgLang: text("tg_lang"),
    refCode: text("ref_code"),
    parentRefCode: text("parent_ref_code"),
    payoutAddress: text("payout_address"),
    payoutAddressChangedAt: timestamp("payout_address_changed_at", {
      withTimezone: true,
    }),
    role: text("role").notNull().default("regular"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("ix_users_parent_ref_code").on(table.parentRefCode)],
);

export const subscriptionPlans = pgTable("subscription_plans", {
  id: smallint("id").primaryKey(),
  name: text("name").notNull(),
  durationDays: integer("duration_days").notNull(),
  priceUsdt: numeric("price_usdt", { precision: 18, scale: 6 }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    planId: smallint("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    depositAddress: text("deposit_address").notNull().unique(),
    derivIndex: integer("deriv_index").notNull(),
    amountUsdt: numeric("amount_usdt", { precision: 18, scale: 6 }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("open"),
    paidTxHash: text("paid_tx_hash").unique(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    hasPartialPayment: boolean("has_partial_payment").notNull().default(false),
    swept: boolean("swept").notNull().default(false),
    sweepTxHash: text("sweep_tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ix_invoices_status_expires").on(table.status, table.expiresAt),
    index("ix_invoices_status_swept").on(table.status, table.swept),
    index("ix_invoices_user_id").on(table.userId),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    channelId: bigint("channel_id", { mode: "bigint" }).notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),
  },
  (table) => [
    index("ix_subscriptions_status_ends").on(table.status, table.endsAt),
    index("ix_subscriptions_user_id").on(table.userId),
  ],
);

export const commissionLedger = pgTable(
  "commission_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    beneficiaryId: uuid("beneficiary_id")
      .notNull()
      .references(() => users.id),
    level: smallint("level").notNull(),
    basisUsdt: numeric("basis_usdt", { precision: 18, scale: 6 }).notNull(),
    rateBps: integer("rate_bps").notNull(),
    amountUsdt: numeric("amount_usdt", { precision: 18, scale: 6 }).notNull(),
    unlockAt: timestamp("unlock_at", { withTimezone: true }).notNull(),
    status: commissionStatusEnum("status").notNull().default("accrued"),
    batchId: uuid("batch_id").references(() => payoutBatches.id),
    paidTxHash: text("paid_tx_hash"),
  },
  (table) => [
    uniqueIndex("uq_commission_ledger_accrual").on(
      table.invoiceId,
      table.beneficiaryId,
      table.level,
    ),
    index("ix_commission_ledger_beneficiary_status").on(
      table.beneficiaryId,
      table.status,
    ),
    index("ix_commission_ledger_unlock_status").on(
      table.unlockAt,
      table.status,
    ),
    check(
      "ck_rate_bps_range",
      sql`${table.rateBps} >= 0 AND ${table.rateBps} <= 10000`,
    ),
  ],
);

export const commissionConfig = pgTable(
  "commission_config",
  {
    id: smallint("id").primaryKey(),
    l1Tiers: jsonb("l1_tiers").notNull(),
    l2Bps: integer("l2_bps").notNull(),
    payoutMode: payoutModeEnum("payout_mode").notNull().default("instant"),
    deferDays: integer("defer_days").notNull().default(0),
    minPayoutUsdt: numeric("min_payout_usdt", { precision: 18, scale: 6 })
      .notNull()
      .default("50.000000"),
  },
  (table) => [
    check(
      "ck_l2_bps_range",
      sql`${table.l2Bps} >= 0 AND ${table.l2Bps} <= 10000`,
    ),
  ],
);

export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    beneficiaryId: uuid("beneficiary_id")
      .notNull()
      .references(() => users.id),
    amountUsdt: numeric("amount_usdt", { precision: 18, scale: 6 }).notNull(),
    txHash: text("tx_hash"),
    broadcastAt: timestamp("broadcast_at", { withTimezone: true }),
    status: batchStatusEnum("status").notNull().default("pending"),
  },
  (table) => [
    index("ix_payout_batches_beneficiary_status").on(
      table.beneficiaryId,
      table.status,
    ),
  ],
);

export const nudgesSent = pgTable(
  "nudges_sent",
  {
    subId: uuid("sub_id")
      .notNull()
      .references(() => subscriptions.id),
    window: text("window").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.subId, table.window] })],
);

export const opsKillSwitch = pgTable("ops_kill_switch", {
  id: smallint("id").primaryKey(),
  buyDisabled: boolean("buy_disabled").notNull().default(false),
  payoutDisabled: boolean("payout_disabled").notNull().default(false),
  reason: text("reason"),
  setAt: timestamp("set_at", { withTimezone: true }),
});

// ── Sequences ────────────────────────────────────────────────────────────────

export const derivIndexSeq = pgSequence("deriv_index_seq", {
  startWith: 1,
  minValue: 1,
  maxValue: 2147483647,
  cycle: false,
});
