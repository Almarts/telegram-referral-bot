-- Campaigns: reusable multi-use invite links granting free access + referral binding
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  invite_link text NOT NULL UNIQUE,
  invite_name text NOT NULL,
  free_days integer NOT NULL DEFAULT 90,
  expires_at timestamptz NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  owner_ref_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_campaigns_active_expires ON campaigns (active, expires_at);

CREATE TABLE IF NOT EXISTS campaign_joins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  tg_user_id bigint NOT NULL,
  state text NOT NULL,
  detail text,
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_joins ON campaign_joins (campaign_id, tg_user_id, state);
CREATE INDEX IF NOT EXISTS ix_campaign_joins_tg ON campaign_joins (tg_user_id);
