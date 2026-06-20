-- Cleanup script: removes all transactional data (buyers, creators, subscriptions, commissions)
-- while preserving: commission_config, ops_kill_switch, and the admin user (TG 607645943)

BEGIN;

-- 1. Delete commission ledger (depends on invoices + users)
DELETE FROM commission_ledger;

-- 2. Delete nudges sent (depends on subscriptions)
DELETE FROM nudges_sent;

-- 3. Delete subscriptions (depends on users + invoices)
DELETE FROM subscriptions;

-- 4. Delete invoices (depends on users)
DELETE FROM invoices;

-- 5. Delete users EXCEPT the admin (TG 607645943)
DELETE FROM users WHERE tg_user_id != 607645943;

-- Reset the deriv index sequence
ALTER SEQUENCE deriv_index_seq RESTART WITH 1;

COMMIT;
