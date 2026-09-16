CREATE TABLE IF NOT EXISTS free_trial_grants (
  tg_user_id bigint PRIMARY KEY,
  source text NOT NULL,
  days integer NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
