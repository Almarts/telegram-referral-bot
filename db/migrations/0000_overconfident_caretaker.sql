CREATE TYPE "public"."batch_status" AS ENUM('pending', 'broadcast', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('accrued', 'payable', 'paid', 'clawed_back');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_mode" AS ENUM('instant', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE SEQUENCE "public"."deriv_index_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "commission_config" (
	"id" smallint PRIMARY KEY NOT NULL,
	"l1_tiers" jsonb NOT NULL,
	"l2_bps" integer NOT NULL,
	"payout_mode" "payout_mode" DEFAULT 'instant' NOT NULL,
	"defer_days" integer DEFAULT 0 NOT NULL,
	"min_payout_usdt" numeric(18, 6) DEFAULT '50.000000' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"basis_usdt" numeric(18, 6) NOT NULL,
	"rate_bps" integer NOT NULL,
	"amount_usdt" numeric(18, 6) NOT NULL,
	"unlock_at" timestamp with time zone NOT NULL,
	"status" "commission_status" DEFAULT 'accrued' NOT NULL,
	"batch_id" uuid,
	"paid_tx_hash" text
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" smallint NOT NULL,
	"deposit_address" text,
	"deriv_index" integer NOT NULL,
	"amount_usdt" numeric(18, 6) NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"paid_tx_hash" text,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"has_partial_payment" boolean DEFAULT false NOT NULL,
	"swept" boolean DEFAULT false NOT NULL,
	"sweep_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_deposit_address_unique" UNIQUE("deposit_address"),
	CONSTRAINT "invoices_paid_tx_hash_unique" UNIQUE("paid_tx_hash")
);
--> statement-breakpoint
CREATE TABLE "nudges_sent" (
	"sub_id" uuid NOT NULL,
	"window" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nudges_sent_sub_id_window_pk" PRIMARY KEY("sub_id","window")
);
--> statement-breakpoint
CREATE TABLE "ops_kill_switch" (
	"id" smallint PRIMARY KEY NOT NULL,
	"buy_disabled" boolean DEFAULT false NOT NULL,
	"payout_disabled" boolean DEFAULT false NOT NULL,
	"reason" text,
	"set_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"amount_usdt" numeric(18, 6) NOT NULL,
	"tx_hash" text,
	"broadcast_at" timestamp with time zone,
	"status" "batch_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" smallint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"duration_days" integer NOT NULL,
	"price_usdt" numeric(18, 6) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"channel_id" bigint NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tg_user_id" bigint NOT NULL,
	"tg_username" text,
	"tg_lang" text,
	"ref_code" text,
	"parent_ref_code" text,
	"payout_address" text,
	"payout_address_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_tg_user_id_unique" UNIQUE("tg_user_id"),
	CONSTRAINT "users_ref_code_unique" UNIQUE("ref_code")
);
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudges_sent" ADD CONSTRAINT "nudges_sent_sub_id_subscriptions_id_fk" FOREIGN KEY ("sub_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_commission_ledger_accrual" ON "commission_ledger" USING btree ("invoice_id","beneficiary_id","level");--> statement-breakpoint
CREATE INDEX "ix_commission_ledger_beneficiary_status" ON "commission_ledger" USING btree ("beneficiary_id","status");--> statement-breakpoint
CREATE INDEX "ix_commission_ledger_unlock_status" ON "commission_ledger" USING btree ("unlock_at","status");--> statement-breakpoint
CREATE INDEX "ix_invoices_status_expires" ON "invoices" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ix_invoices_status_swept" ON "invoices" USING btree ("status","swept");--> statement-breakpoint
CREATE INDEX "ix_invoices_user_id" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_subscriptions_status_ends" ON "subscriptions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "ix_subscriptions_user_id" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_users_parent_ref_code" ON "users" USING btree ("parent_ref_code");