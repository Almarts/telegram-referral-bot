const { Pool } = require('pg');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
const { config } = require('dotenv');
config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  // Check my user (by ref_code EW0B4C)
  const me = await pool.query(
    `SELECT id, ref_code, parent_ref_code FROM users WHERE ref_code = 'EW0B4C'`
  );
  console.log('My user:', me.rows[0]);

  // Check my referrals
  const refs = await pool.query(
    `SELECT id, ref_code, parent_ref_code FROM users WHERE parent_ref_code = 'EW0B4C'`
  );
  console.log('My referrals:', refs.rows.length);
  refs.rows.forEach(r => console.log(' -', r));

  // Check all invoices
  const invs = await pool.query(
    `SELECT id, user_id, status, amount_usdt, created_at, paid_at
     FROM invoices ORDER BY created_at DESC LIMIT 20`
  );
  console.log('\nAll invoices:');
  invs.rows.forEach(r => console.log(JSON.stringify(r)));

  // Check commission config
  const cfg = await pool.query('SELECT * FROM commission_config');
  console.log('\nCommission config:', cfg.rows);

  // Check if there are any ledger entries at all
  const ledger = await pool.query('SELECT * FROM commission_ledger');
  console.log('\nLedger entries:', ledger.rows.length);
  ledger.rows.forEach(r => console.log(JSON.stringify(r)));

  // Let's also try calling accrueCommissions manually from the code
  console.log('\n--- Trying to import and call accrueCommissions ---');
  try {
    const { accrueCommissions } = require('../lib/commissions.cjs');
    // Doesn't exist - need to use tsx or ts-node
    console.log('Cannot import from ts directly');
  } catch(e) {
    console.log('Import failed:', e.message);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
