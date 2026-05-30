import pg from "pg";

async function seed() {
  const pool = new pg.Pool({
    host: "zephyr.proxy.rlwy.net",
    port: 23235,
    user: "postgres",
    password: "zZQTQwWVtlvoOuqWIdyqmsuFVvyITYuF",
    database: "railway",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  console.log("Connecting...");

  try {
    await pool.query(
      `INSERT INTO "subscription_plans" (id, name, duration_days, price_usdt, active)
       VALUES (1, '1 month', 30, '9.990000', true),
              (2, '3 months', 90, '24.990000', true),
              (3, '1 year', 365, '79.990000', true)
       ON CONFLICT (id) DO NOTHING`
    );
    console.log("subscription_plans ✓");

    await pool.query(
      `INSERT INTO "commission_config" (id, l1_tiers, l2_bps, payout_mode, defer_days, min_payout_usdt)
       VALUES (1, '[{"min":0,"bps":2000},{"min":10,"bps":3000}]'::jsonb, 1000, 'instant', 0, '50.000000')
       ON CONFLICT (id) DO NOTHING`
    );
    console.log("commission_config ✓");

    await pool.query(
      `INSERT INTO "ops_kill_switch" (id, buy_disabled, payout_disabled, reason, set_at)
       VALUES (1, false, false, NULL, NULL)
       ON CONFLICT (id) DO NOTHING`
    );
    console.log("ops_kill_switch ✓");

    console.log("\nAll seeded!");
  } catch (err) {
    console.error("Failed:", (err as Error).message);
    throw err;
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
