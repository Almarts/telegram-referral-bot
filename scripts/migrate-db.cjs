/**
 * Recreate all tables to match the current schema.ts
 * Run: node scripts/migrate-db.cjs
 */
const { Pool } = require('pg');
const pool = new Pool({
  host: 'zephyr.proxy.rlwy.net',
  port: 23235,
  user: 'postgres',
  password: 'zZQTQwWVtlvoOuqWIdyqmsuFVvyITYuF',
  database: 'railway',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('Recreating tables...\n');

  // 1. Drop old tables in reverse dependency order
  const dropOld = [
    'DROP TABLE IF EXISTS payout_batches_old CASCADE',
    'DROP TABLE IF EXISTS nudges_sent CASCADE',
    'DROP TABLE IF EXISTS payout_batches CASCADE',
    'DROP TABLE IF EXISTS commission_ledger CASCADE',
    'DROP TABLE IF EXISTS commission_config CASCADE',
    'DROP TABLE IF EXISTS subscriptions CASCADE',
    'DROP TABLE IF EXISTS subscription_access CASCADE',
    'DROP TABLE IF EXISTS user_referral CASCADE',
    'DROP TABLE IF EXISTS invoices CASCADE',
    'DROP TABLE IF EXISTS subscription_plans CASCADE',
    'DROP TABLE IF EXISTS users CASCADE',
    'DROP TABLE IF EXISTS ops_kill_switch CASCADE',
  ];
  for (const sql of dropOld) {
    await pool.query(sql);
    console.log('  ' + sql.split(' ').slice(2,4).join(' '));
  }

  // 2. Create enums (if not exist)
  await pool.query(`CREATE TYPE IF NOT EXISTS invoice_status AS ENUM ('open','paid','expired','refunded')`);
  await pool.query(`CREATE TYPE IF NOT EXISTS subscription_status AS ENUM ('active','expired','revoked')`);
  await pool.query(`CREATE TYPE IF NOT EXISTS commission_status AS ENUM ('accrued','payable','paid','clawed_back')`);
  await pool.query(`CREATE TYPE IF NOT EXISTS payout_mode AS ENUM ('instant','deferred')`);
  await pool.query(`CREATE TYPE IF NOT EXISTS batch_status AS ENUM ('pending','broadcast','confirmed','failed')`);
  console.log('  Enums created');

  // 3. Create users table
  await pool.query(`
    CREATE TABLE users (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      tg_user_id BIGINT NOT NULL UNIQUE,
      tg_username TEXT,
      tg_lang TEXT,
      ref_code TEXT,
      parent_ref_code TEXT,
      payout_address TEXT,
      payout_address_changed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);
  await pool.query('CREATE INDEX ix_users_parent_ref_code ON users(parent_ref_code)');
  console.log('  users');

  // 4. subscription_plans
  await pool.query(`
    CREATE TABLE subscription_plans (
      id SMALLINT PRIMARY KEY,
      name TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      price_usdt NUMERIC(18,6) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true
    )
  `);
  // Restore existing plans
  await pool.query(`INSERT INTO subscription_plans VALUES 
    (1, '1 month', 30, 9.990000, true),
    (2, '3 months', 90, 24.990000, true),
    (3, '1 year', 365, 79.990000, true)
  `);
  console.log('  subscription_plans (3 plans restored)');

  // 5. invoices
  await pool.query(`
    CREATE TABLE invoices (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      plan_id SMALLINT NOT NULL REFERENCES subscription_plans(id),
      deposit_address TEXT NOT NULL UNIQUE,
      deriv_index INTEGER NOT NULL,
      amount_usdt NUMERIC(18,6) NOT NULL,
      status invoice_status NOT NULL DEFAULT 'open',
      paid_tx_hash TEXT UNIQUE,
      paid_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      has_partial_payment BOOLEAN NOT NULL DEFAULT false,
      swept BOOLEAN NOT NULL DEFAULT false,
      sweep_tx_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);
  await pool.query('CREATE INDEX ix_invoices_status_expires ON invoices(status, expires_at)');
  await pool.query('CREATE INDEX ix_invoices_status_swept ON invoices(status, swept)');
  await pool.query('CREATE INDEX ix_invoices_user_id ON invoices(user_id)');
  console.log('  invoices');

  // 6. subscriptions
  await pool.query(`
    CREATE TABLE subscriptions (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      invoice_id UUID NOT NULL REFERENCES invoices(id),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      channel_id BIGINT NOT NULL,
      status subscription_status NOT NULL DEFAULT 'active'
    )
  `);
  await pool.query('CREATE INDEX ix_subscriptions_status_ends ON subscriptions(status, ends_at)');
  await pool.query('CREATE INDEX ix_subscriptions_user_id ON subscriptions(user_id)');
  console.log('  subscriptions');

  // 7. payout_batches
  await pool.query(`
    CREATE TABLE payout_batches (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      beneficiary_id UUID NOT NULL REFERENCES users(id),
      amount_usdt NUMERIC(18,6) NOT NULL,
      tx_hash TEXT,
      broadcast_at TIMESTAMPTZ,
      status batch_status NOT NULL DEFAULT 'pending'
    )
  `);
  await pool.query('CREATE INDEX ix_payout_batches_beneficiary_status ON payout_batches(beneficiary_id, status)');
  console.log('  payout_batches');

  // 8. commission_ledger
  await pool.query(`
    CREATE TABLE commission_ledger (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      invoice_id UUID NOT NULL REFERENCES invoices(id),
      beneficiary_id UUID NOT NULL REFERENCES users(id),
      level SMALLINT NOT NULL,
      basis_usdt NUMERIC(18,6) NOT NULL,
      rate_bps INTEGER NOT NULL,
      amount_usdt NUMERIC(18,6) NOT NULL,
      unlock_at TIMESTAMPTZ NOT NULL,
      status commission_status NOT NULL DEFAULT 'accrued',
      batch_id UUID REFERENCES payout_batches(id),
      paid_tx_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);
  await pool.query('CREATE UNIQUE INDEX uq_commission_ledger_accrual ON commission_ledger(invoice_id, beneficiary_id, level)');
  await pool.query('CREATE INDEX ix_commission_ledger_beneficiary_status ON commission_ledger(beneficiary_id, status)');
  await pool.query('CREATE INDEX ix_commission_ledger_unlock_status ON commission_ledger(unlock_at, status)');
  console.log('  commission_ledger');

  // 9. commission_config
  await pool.query(`
    CREATE TABLE commission_config (
      id SMALLINT PRIMARY KEY,
      l1_tiers JSONB NOT NULL,
      l2_bps INTEGER NOT NULL,
      payout_mode payout_mode NOT NULL DEFAULT 'instant',
      defer_days INTEGER NOT NULL DEFAULT 0,
      min_payout_usdt NUMERIC(18,6) NOT NULL DEFAULT '50.000000'
    )
  `);
  // Insert default config
  await pool.query(`INSERT INTO commission_config (id, l1_tiers, l2_bps) VALUES 
    (1, '[{"min": 0, "bps": 2000}, {"min": 10, "bps": 3000}]'::jsonb, 1000)
  `);
  console.log('  commission_config');

  // 10. ops_kill_switch
  await pool.query(`
    CREATE TABLE ops_kill_switch (
      id SMALLINT PRIMARY KEY,
      buy_disabled BOOLEAN NOT NULL DEFAULT false,
      payout_disabled BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await pool.query(`INSERT INTO ops_kill_switch (id, buy_disabled, payout_disabled) VALUES (1, false, false)`);
  console.log('  ops_kill_switch');

  // 11. deriv_index_seq
  await pool.query('CREATE SEQUENCE IF NOT EXISTS deriv_index_seq START 1');
  console.log('  deriv_index_seq');

  // 12. Re-create your user
  await pool.query(`
    INSERT INTO users (tg_user_id, tg_username, tg_lang, ref_code)
    VALUES (607645943, 'al_marts', 'ru', 'TCKSHE')
  `);
  console.log('  Your user restored ✅');

  console.log('\n✅ All tables created successfully!');
  await pool.end();
}

run().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
