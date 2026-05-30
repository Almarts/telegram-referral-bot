import pg from "pg";

const pool = new pg.Pool({
  host: "zephyr.proxy.rlwy.net",
  port: 23235,
  user: "postgres",
  password: "zZQTQwWVtlvoOuqWIdyqmsuFVvyITYuF",
  database: "railway",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

async function run() {
  try {
    // Migration 0000
    await pool.query(`
CREATE TYPE "public"."batch_status" AS ENUM('pending', 'broadcast', 'confirmed', 'failed');
CREATE TYPE "public"."commission_status" AS ENUM('accrued', 'payable', 'paid', 'clawed_back');
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'settled', 'expired', 'refunded');
CREATE TYPE "public"."payout_mode" AS ENUM('instant', 'deferred');
CREATE TABLE IF NOT EXISTS "commission_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"l1_tiers" jsonb NOT NULL,
	"l2_bps" integer NOT NULL,
	"payout_mode" "payout_mode" DEFAULT 'instant' NOT NULL,
	"defer_days" integer DEFAULT 0 NOT NULL,
	"min_payout_usdt" numeric(18, 6) DEFAULT '50.000000' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "commission_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_invoice_id" integer NOT NULL,
	"level" integer NOT NULL,
	"recipient_tg_id" bigint NOT NULL,
	"amount_usdt" numeric(18, 6) NOT NULL,
	"status" "commission_status" DEFAULT 'accrued' NOT NULL,
	"paid_at" timestamp with time zone,
	"batch_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"tg_id" bigint NOT NULL,
	"deposit_address" text,
	"derivation_index" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"amount_usdt" numeric(18, 6) NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"usdt_received" numeric(18, 6) DEFAULT '0.000000',
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"renewed_from" integer,
	"subscription_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "ops_kill_switch" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"buy_disabled" boolean DEFAULT false NOT NULL,
	"payout_disabled" boolean DEFAULT false NOT NULL,
	"reason" text,
	"set_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "payout_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" "batch_status" DEFAULT 'pending' NOT NULL,
	"total_usdt" numeric(18, 6) NOT NULL,
	"receiver_count" integer NOT NULL,
	"tx_id" text,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "subscription_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"tg_id" bigint NOT NULL,
	"invoice_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"reminded_3d" boolean DEFAULT false,
	"reminded_1d" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"duration_days" integer NOT NULL,
	"price_usdt" numeric(18, 6) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_referral" (
	"tg_id" bigint PRIMARY KEY NOT NULL,
	"ref_code" varchar(16) NOT NULL,
	"referred_by" bigint,
	"payout_address" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_referral_ref_code_unique" UNIQUE("ref_code")
);
CREATE INDEX IF NOT EXISTS "idx_invoices_status" ON "invoices" ("status");
CREATE INDEX IF NOT EXISTS "idx_invoices_tg_id" ON "invoices" ("tg_id");
CREATE INDEX IF NOT EXISTS "idx_commission_ledger_recipient" ON "commission_ledger" ("recipient_tg_id");
CREATE INDEX IF NOT EXISTS "idx_subscription_access_tg_id" ON "subscription_access" ("tg_id");
`);
    console.log("Migration 0000 ✓");

    // Migration 0001
    await pool.query(`
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscription_access_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscription_access"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subscription_access" ADD CONSTRAINT "subscription_access_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
`);
    console.log("Migration 0001 ✓");

    // Migration 0002
    await pool.query(`
ALTER TABLE "invoices" ALTER COLUMN "deposit_address" SET NOT NULL;
`);
    console.log("Migration 0002 ✓");

    console.log("\nAll migrations applied!");
  } catch (err) {
    console.error("Migration failed:", (err as Error).message);
    throw err;
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
