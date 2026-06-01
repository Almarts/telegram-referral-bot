-- Drop all existing tables (order matters for foreign keys)
DROP TABLE IF EXISTS commission_ledger CASCADE;
DROP TABLE IF EXISTS payout_batches CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
DROP TABLE IF EXISTS wallet_queue CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS payout_batch_status CASCADE;
DROP TYPE IF EXISTS invoice_status CASCADE;
DROP TYPE IF EXISTS subscription_status CASCADE;
DROP TYPE IF EXISTS commission_status CASCADE;

-- Enums
CREATE TYPE payout_batch_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE invoice_status AS ENUM ('pending', 'paid', 'expired', 'failed');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled');
CREATE TYPE commission_status AS ENUM ('pending', 'unlocked', 'paid', 'cancelled');

-- Users
CREATE TABLE users (
    id BIGINT PRIMARY KEY,  -- Telegram user_id
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    referral_code VARCHAR(10) UNIQUE NOT NULL,
    referred_by BIGINT REFERENCES users(id),
    total_earned_usdt DECIMAL(20,8) DEFAULT 0,
    total_referrals INTEGER DEFAULT 0,
    is_admin BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Referrals
CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id BIGINT NOT NULL REFERENCES users(id),
    referred_id BIGINT NOT NULL REFERENCES users(id) UNIQUE,
    referred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invoices
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES users(id),
    plan_id INTEGER NOT NULL,
    amount_usdt DECIMAL(20,8) NOT NULL,
    deposit_address VARCHAR(255) NOT NULL,
    derivation_index INTEGER NOT NULL,
    usdt_received DECIMAL(20,8) DEFAULT 0,
    status invoice_status DEFAULT 'pending',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE,
    tx_hash VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES users(id),
    plan_id INTEGER NOT NULL,
    invoice_id UUID REFERENCES invoices(id),
    status subscription_status DEFAULT 'active',
    starts_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Commission Ledger
CREATE TABLE commission_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    beneficiary_id BIGINT NOT NULL REFERENCES users(id),
    amount_usdt DECIMAL(20,8) NOT NULL,
    level INTEGER NOT NULL,
    source_user_id BIGINT NOT NULL,
    status commission_status DEFAULT 'pending',
    unlock_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payout Batches
CREATE TABLE payout_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status payout_batch_status DEFAULT 'pending',
    total_amount DECIMAL(20,8) DEFAULT 0,
    recipient_count INTEGER DEFAULT 0,
    tx_hash VARCHAR(255),
    broadcast_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Wallet Queue (for TRON address derivation)
CREATE TABLE wallet_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index INTEGER UNIQUE NOT NULL,
    address VARCHAR(255) UNIQUE NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Referral code index
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_deposit_address ON invoices(deposit_address);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_commission_ledger_beneficiary ON commission_ledger(beneficiary_id);
CREATE INDEX idx_commission_ledger_status ON commission_ledger(status);
