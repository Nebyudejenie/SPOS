-- SPOS (Smart POS) — Database schema
-- Runs automatically on first container start (mounted into /docker-entrypoint-initdb.d).
-- Database "appdb" is created by the postgres image via POSTGRES_DB.

-- gen_random_uuid() is built into PostgreSQL 13+ via pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Merchants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_code         VARCHAR(32)  NOT NULL UNIQUE,            -- e.g. SP002221
    merchant_name         VARCHAR(255) NOT NULL,
    business_type         VARCHAR(120),                            -- Category, e.g. Hospital
    owner_name            VARCHAR(160),
    phone_number          VARCHAR(40),
    address               TEXT,
    region                VARCHAR(120),
    sales_officer         VARCHAR(160),
    activation_officer    VARCHAR(160),
    account_manager       VARCHAR(160),
    assigned_pos          VARCHAR(120),                            -- free-text terminal ref
    bank                  VARCHAR(160),
    settlement_account    VARCHAR(64),
    qr_status             VARCHAR(32)  NOT NULL DEFAULT 'inactive',
    pos_status            VARCHAR(32)  NOT NULL DEFAULT 'inactive',
    activation_date       DATE,
    last_transaction_date DATE,
    monthly_volume        NUMERIC(14,2) NOT NULL DEFAULT 0,
    support_history       TEXT,
    current_status        VARCHAR(32)  NOT NULL DEFAULT 'active',  -- active | inactive | suspended
    notes                 TEXT,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchants_region        ON merchants (region);
CREATE INDEX IF NOT EXISTS idx_merchants_current_status ON merchants (current_status);

-- ---------------------------------------------------------------------------
-- POS Devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    terminal_id         VARCHAR(64)  NOT NULL UNIQUE,             -- e.g. TP100234
    serial_number       VARCHAR(120),
    model               VARCHAR(120),                            -- e.g. TopWise A8
    merchant_id         UUID REFERENCES merchants (id) ON DELETE SET NULL,
    merchant_name       VARCHAR(255),                            -- denormalized snapshot
    bank                VARCHAR(160),
    sim_number          VARCHAR(40),
    activation_date     DATE,
    last_communication  TIMESTAMPTZ,
    status              VARCHAR(32)  NOT NULL DEFAULT 'inactive', -- active | inactive | faulty
    transaction_volume  NUMERIC(14,2) NOT NULL DEFAULT 0,
    error_history       TEXT,
    replacement_history TEXT,
    current_owner       VARCHAR(160),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_devices_merchant_id ON pos_devices (merchant_id);
CREATE INDEX IF NOT EXISTS idx_pos_devices_status      ON pos_devices (status);

-- ---------------------------------------------------------------------------
-- Auto-maintain updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_merchants_updated_at ON merchants;
CREATE TRIGGER trg_merchants_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_pos_devices_updated_at ON pos_devices;
CREATE TRIGGER trg_pos_devices_updated_at
    BEFORE UPDATE ON pos_devices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed data (from idea.md examples)
-- ---------------------------------------------------------------------------
INSERT INTO merchants (
    merchant_code, merchant_name, business_type, region, bank, assigned_pos,
    current_status, activation_date, last_transaction_date, sales_officer,
    qr_status, pos_status, support_history
) VALUES (
    'SP002221',
    'INTERNATIONAL CARDIOVASCULAR MEDICAL CENTER',
    'Hospital',
    'Addis Ababa',
    'Awash Bank',
    'TP12345678',
    'active',
    '2025-05-20',
    '2026-06-24',
    'Dawit Abebe',
    'active',
    'active',
    E'2026-06-23 Merchant reported transaction issue.\nResolution: Restart POS and key download.'
) ON CONFLICT (merchant_code) DO NOTHING;

INSERT INTO pos_devices (
    terminal_id, model, merchant_id, merchant_name, bank, status,
    last_communication, activation_date, error_history
)
SELECT
    'TP100234', 'TopWise A8', m.id, m.merchant_name, 'Awash Bank', 'active',
    '2026-06-25 09:00:00+00', '2025-05-20', 'None'
FROM merchants m
WHERE m.merchant_code = 'SP002221'
ON CONFLICT (terminal_id) DO NOTHING;
