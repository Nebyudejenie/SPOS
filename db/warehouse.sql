-- ===========================================================================
-- SPOS Data Warehouse — flexible 3-layer (bronze/silver/gold) schema
-- Designed from deep analysis of the 372 files in data/ (see DATA_MODEL.md).
--
-- Goals:
--   * LOSSLESS  — every row of every sheet is stored verbatim (bronze).
--   * FLEXIBLE  — every curated table has an `attributes JSONB` overflow so
--                 unexpected columns are never dropped; new schemas never break.
--   * TRACEABLE — every curated row carries `source_ref` lineage to bronze.
--   * RELATIONAL— merchants ↔ devices ↔ transactions ↔ tickets are real FKs,
--                 enabling the idea.md health scoring + knowledge graph.
--
-- Everything lives in schema `spos` so it never collides with the CRUD app's
-- public.merchants / public.pos_devices tables.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE SCHEMA IF NOT EXISTS spos;
SET search_path TO spos, public;

-- Shared updated_at trigger fn (schema-qualified copy).
CREATE OR REPLACE FUNCTION spos.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ===========================================================================
-- BRONZE — raw, lossless staging
-- ===========================================================================

CREATE TABLE IF NOT EXISTS spos.source_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename    TEXT NOT NULL,
    ext         TEXT,
    sha256      TEXT,                       -- dedup identical files
    size_bytes  BIGINT,
    file_mtime  TIMESTAMPTZ,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (filename)
);

CREATE TABLE IF NOT EXISTS spos.source_sheets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id           UUID NOT NULL REFERENCES spos.source_files(id) ON DELETE CASCADE,
    sheet_name        TEXT,
    header_row_index  INT,                  -- where the header was detected
    header_signature  TEXT,                 -- normalized header fingerprint
    headers           JSONB,                -- ordered list of raw headers
    ncols             INT,
    nrows             INT,
    template_guess    TEXT,                 -- classifier label (e.g. 'device_snapshot')
    UNIQUE (file_id, sheet_name)
);

-- One row per data row from any sheet. `data` keys = the sheet's headers.
CREATE TABLE IF NOT EXISTS spos.raw_rows (
    id          BIGSERIAL PRIMARY KEY,
    sheet_id    UUID NOT NULL REFERENCES spos.source_sheets(id) ON DELETE CASCADE,
    row_index   INT NOT NULL,
    data        JSONB NOT NULL,
    promoted_to TEXT,                        -- which silver table consumed it (audit)
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_raw_rows_sheet ON spos.raw_rows (sheet_id);
CREATE INDEX IF NOT EXISTS idx_raw_rows_data  ON spos.raw_rows USING GIN (data);

-- Dictionary that drives the silver ETL: messy header -> canonical field.
CREATE TABLE IF NOT EXISTS spos.column_aliases (
    id               BIGSERIAL PRIMARY KEY,
    canonical_entity TEXT NOT NULL,          -- e.g. 'merchants'
    canonical_field  TEXT NOT NULL,          -- e.g. 'trading_name'
    source_alias     TEXT NOT NULL,          -- normalized source header
    notes            TEXT,
    UNIQUE (canonical_entity, source_alias)
);

-- ===========================================================================
-- SILVER — curated, typed entities (each with attributes JSONB + source_ref)
-- Convention:
--   attributes JSONB  -> any source column we did not map to a typed field
--   source_ref JSONB  -> { "file": ..., "sheet": ..., "row": ... } lineage
-- ===========================================================================

-- ---- Reference / dimensions -------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.banks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL UNIQUE,
    aliases    JSONB NOT NULL DEFAULT '[]',  -- ["Awash","AWASH BANK",...]
    attributes JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spos.employees (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name  TEXT,
    email      TEXT UNIQUE,
    phone      TEXT,
    role       TEXT,                          -- sales | activation | encoder | call_center | coordinator
    region     TEXT,
    attributes JSONB NOT NULL DEFAULT '{}',
    source_ref JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_name ON spos.employees (lower(full_name));

-- ---- Merchants (canonical) --------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.merchants (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_code          TEXT UNIQUE,       -- SP002221 / SP0000000002600
    qr_merchant_id         TEXT,              -- 396973
    trading_name           TEXT,              -- MRC TRADING/REGISTERED NAME
    business_type          TEXT,
    owner_name             TEXT,
    contact_person         TEXT,
    phone                  TEXT,
    phone_alt              TEXT,
    email                  TEXT,
    license_number         TEXT,
    bank_id                UUID REFERENCES spos.banks(id) ON DELETE SET NULL,
    settlement_account     TEXT,
    settlement_account_name TEXT,
    address                TEXT,
    region                 TEXT,
    city                   TEXT,
    subcity                TEXT,
    woreda                 TEXT,
    branch                 TEXT,
    branch_count           INT,
    latitude               NUMERIC(10,6),
    longitude              NUMERIC(10,6),
    gps_link               TEXT,
    sales_officer_id       UUID REFERENCES spos.employees(id) ON DELETE SET NULL,
    activation_officer_id  UUID REFERENCES spos.employees(id) ON DELETE SET NULL,
    account_manager_id     UUID REFERENCES spos.employees(id) ON DELETE SET NULL,
    recruited_by_id        UUID REFERENCES spos.employees(id) ON DELETE SET NULL,
    recruited_date         DATE,
    activation_date        DATE,
    qr_status              TEXT,
    pos_status             TEXT,
    current_status         TEXT,              -- active | inactive | closed | suspended
    attributes             JSONB NOT NULL DEFAULT '{}',
    source_ref             JSONB,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_merchants_qr     ON spos.merchants (qr_merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchants_phone  ON spos.merchants (phone);
CREATE INDEX IF NOT EXISTS idx_merchants_name   ON spos.merchants (lower(trading_name));
CREATE INDEX IF NOT EXISTS idx_merchants_region ON spos.merchants (region);
CREATE INDEX IF NOT EXISTS idx_merchants_attrs  ON spos.merchants USING GIN (attributes);
DROP TRIGGER IF EXISTS trg_merchants_upd ON spos.merchants;
CREATE TRIGGER trg_merchants_upd BEFORE UPDATE ON spos.merchants
    FOR EACH ROW EXECUTE FUNCTION spos.set_updated_at();

-- ---- Bank accounts (settlement) + replacement history -----------------------
CREATE TABLE IF NOT EXISTS spos.bank_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID REFERENCES spos.merchants(id) ON DELETE CASCADE,
    bank_id         UUID REFERENCES spos.banks(id) ON DELETE SET NULL,
    account_number  TEXT,
    account_holder  TEXT,
    is_current      BOOLEAN NOT NULL DEFAULT TRUE,
    replaced_from   TEXT,                     -- previous account no
    replaced_at     DATE,
    ordered_by      TEXT,
    attributes      JSONB NOT NULL DEFAULT '{}',
    source_ref      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_merchant ON spos.bank_accounts (merchant_id);

-- ---- SIM cards --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.sim_cards (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sim_number    TEXT,                        -- printed SIM no
    msisdn        TEXT,                        -- service/phone number
    iccid         TEXT,
    sim_type      TEXT,
    provider      TEXT,                        -- ethio telecom, ...
    service_type  TEXT,
    customer_name TEXT,
    status        TEXT,
    attributes    JSONB NOT NULL DEFAULT '{}',
    source_ref    JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sim_number)
);
CREATE INDEX IF NOT EXISTS idx_sim_msisdn ON spos.sim_cards (msisdn);
CREATE INDEX IF NOT EXISTS idx_sim_iccid  ON spos.sim_cards (iccid);

-- ---- POS devices (physical) -------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.pos_devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number       TEXT UNIQUE,           -- P3909.../S3909... (most reliable key)
    terminal_id         TEXT,                  -- TP100234 / SP002xxx
    psn                 TEXT,                  -- device-mgmt serial (health export)
    bank_terminal_id    TEXT,
    device_type         TEXT,
    model               TEXT,                  -- TopWise A8 ...
    manufacturer        TEXT,
    firmware_version    TEXT,
    hardware_version    TEXT,
    pci_version         TEXT,
    profile_version     TEXT,
    imei1               TEXT,
    imei2               TEXT,
    sim_id              UUID REFERENCES spos.sim_cards(id) ON DELETE SET NULL,
    current_merchant_id UUID REFERENCES spos.merchants(id) ON DELETE SET NULL,
    current_status      TEXT,                  -- in_stock|deployed|returned|faulty|active|inactive|lost
    ownership           TEXT,
    production_date     DATE,
    activation_date     DATE,
    first_report        TIMESTAMPTZ,
    last_access_time    TIMESTAMPTZ,
    attributes          JSONB NOT NULL DEFAULT '{}',
    source_ref          JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devices_terminal ON spos.pos_devices (terminal_id);
CREATE INDEX IF NOT EXISTS idx_devices_psn      ON spos.pos_devices (psn);
CREATE INDEX IF NOT EXISTS idx_devices_merchant ON spos.pos_devices (current_merchant_id);
CREATE INDEX IF NOT EXISTS idx_devices_status   ON spos.pos_devices (current_status);
CREATE INDEX IF NOT EXISTS idx_devices_attrs    ON spos.pos_devices USING GIN (attributes);
DROP TRIGGER IF EXISTS trg_devices_upd ON spos.pos_devices;
CREATE TRIGGER trg_devices_upd BEFORE UPDATE ON spos.pos_devices
    FOR EACH ROW EXECUTE FUNCTION spos.set_updated_at();

-- ---- Device assignment / lifecycle events -----------------------------------
CREATE TABLE IF NOT EXISTS spos.device_assignments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     UUID REFERENCES spos.pos_devices(id) ON DELETE CASCADE,
    merchant_id   UUID REFERENCES spos.merchants(id) ON DELETE SET NULL,
    event_type    TEXT NOT NULL,               -- deploy|return|replace|handover|stock
    event_date    DATE,
    performed_by  UUID REFERENCES spos.employees(id) ON DELETE SET NULL,
    received_by   TEXT,
    location      TEXT,
    latitude      NUMERIC(10,6),
    longitude     NUMERIC(10,6),
    photo_url     TEXT,
    condition     TEXT,                         -- "NO COVER, NO CHARGER, WITH SIM"
    remark        TEXT,
    group_id      TEXT,
    trello_card_url TEXT,
    attributes    JSONB NOT NULL DEFAULT '{}',
    source_ref    JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assign_device   ON spos.device_assignments (device_id);
CREATE INDEX IF NOT EXISTS idx_assign_merchant ON spos.device_assignments (merchant_id);
CREATE INDEX IF NOT EXISTS idx_assign_type     ON spos.device_assignments (event_type);

-- ---- Device telemetry (time-series snapshots) -------------------------------
CREATE TABLE IF NOT EXISTS spos.device_telemetry (
    id                BIGSERIAL PRIMARY KEY,
    device_id         UUID REFERENCES spos.pos_devices(id) ON DELETE CASCADE,
    serial_number     TEXT,                     -- kept for late-binding when device not yet resolved
    terminal_id       TEXT,
    snapshot_at       TIMESTAMPTZ,
    snapshot_date     DATE,
    device_status     TEXT,                     -- Online/Offline/active/...
    connectivity      TEXT,
    battery_level     NUMERIC,
    signal_strength   TEXT,
    cpu_usage         NUMERIC,
    available_memory  TEXT,
    available_storage TEXT,
    network_type      TEXT,
    ip                TEXT,
    latitude          NUMERIC(10,6),
    longitude         NUMERIC(10,6),
    last_access_time  TIMESTAMPTZ,
    firmware_version  TEXT,
    attributes        JSONB NOT NULL DEFAULT '{}',
    source_ref        JSONB
);
CREATE INDEX IF NOT EXISTS idx_tele_device ON spos.device_telemetry (device_id);
CREATE INDEX IF NOT EXISTS idx_tele_serial ON spos.device_telemetry (serial_number);
CREATE INDEX IF NOT EXISTS idx_tele_date   ON spos.device_telemetry (snapshot_date);

-- ---- Derived health scores --------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.device_health_scores (
    id            BIGSERIAL PRIMARY KEY,
    device_id     UUID REFERENCES spos.pos_devices(id) ON DELETE CASCADE,
    serial_number TEXT,
    psn           TEXT,
    as_of         DATE,
    health_score  NUMERIC,
    health_bucket TEXT,                          -- Green|Yellow|Red
    last_seen_hrs NUMERIC,
    battery_level NUMERIC,
    signal_strength TEXT,
    attributes    JSONB NOT NULL DEFAULT '{}',
    source_ref    JSONB
);
CREATE INDEX IF NOT EXISTS idx_health_device ON spos.device_health_scores (device_id);
CREATE INDEX IF NOT EXISTS idx_health_asof   ON spos.device_health_scores (as_of);

-- ---- Transactions (raw) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id      TEXT,
    terminal_id      TEXT,
    terminal_name    TEXT,
    merchant_id      UUID REFERENCES spos.merchants(id) ON DELETE SET NULL,
    bank_merchant_id TEXT,
    bank_terminal_id TEXT,
    amount           NUMERIC(16,2),
    actual_amount    NUMERIC(16,2),
    transaction_type TEXT,
    payment_via      TEXT,
    pan_number       TEXT,
    account_number   TEXT,
    invoice_number   TEXT,
    rrn              TEXT,
    stan             TEXT,
    auth_id          TEXT,
    response_code    TEXT,
    status           TEXT,
    settled          BOOLEAN,
    void             BOOLEAN,
    created_at       TIMESTAMPTZ,
    attributes       JSONB NOT NULL DEFAULT '{}',
    source_ref       JSONB
);
CREATE INDEX IF NOT EXISTS idx_txn_terminal ON spos.transactions (terminal_id);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON spos.transactions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_txn_created  ON spos.transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_txn_rrn      ON spos.transactions (rrn);

-- ---- Transaction summaries (per terminal / period) --------------------------
CREATE TABLE IF NOT EXISTS spos.transaction_summaries (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start             DATE,
    period_end               DATE,
    terminal_id              TEXT,
    terminal_name            TEXT,
    merchant_id              UUID REFERENCES spos.merchants(id) ON DELETE SET NULL,
    merchant_external_id     TEXT,
    total_transaction_count  BIGINT,
    total_transaction_amount NUMERIC(18,2),
    total_purchase_count     BIGINT,
    total_purchase_amount    NUMERIC(18,2),
    gateway_transaction_count BIGINT,
    gateway_transaction_amount NUMERIC(18,2),
    santimpay_commission     NUMERIC(18,2),
    total_commission_br      NUMERIC(18,2),
    total_commission_cut     NUMERIC(18,2),
    attributes               JSONB NOT NULL DEFAULT '{}',
    source_ref               JSONB
);
CREATE INDEX IF NOT EXISTS idx_txnsum_terminal ON spos.transaction_summaries (terminal_id);
CREATE INDEX IF NOT EXISTS idx_txnsum_period   ON spos.transaction_summaries (period_start, period_end);

-- ---- Settlements ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.settlements (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id   UUID REFERENCES spos.merchants(id) ON DELETE SET NULL,
    merchant_ref  TEXT,
    terminal_id   TEXT,
    amount        NUMERIC(16,2),
    settled       BOOLEAN,
    void          BOOLEAN,
    response_code TEXT,
    rrn           TEXT,
    stan          TEXT,
    txn_type      TEXT,
    status        TEXT,
    settled_at    TIMESTAMPTZ,
    attributes    JSONB NOT NULL DEFAULT '{}',
    source_ref    JSONB
);
CREATE INDEX IF NOT EXISTS idx_settle_merchant ON spos.settlements (merchant_id);
CREATE INDEX IF NOT EXISTS idx_settle_at       ON spos.settlements (settled_at);

-- ---- Support tickets --------------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.tickets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_code TEXT,
    merchant_id UUID REFERENCES spos.merchants(id) ON DELETE SET NULL,
    device_id   UUID REFERENCES spos.pos_devices(id) ON DELETE SET NULL,
    reported_by TEXT,
    issue       TEXT,
    category    TEXT,
    resolution  TEXT,
    status      TEXT,
    opened_at   DATE,
    closed_at   DATE,
    attributes  JSONB NOT NULL DEFAULT '{}',
    source_ref  JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_merchant ON spos.tickets (merchant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_device   ON spos.tickets (device_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status   ON spos.tickets (status);

-- ---- Call-center follow-ups -------------------------------------------------
CREATE TABLE IF NOT EXISTS spos.call_followups (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id       UUID REFERENCES spos.merchants(id) ON DELETE SET NULL,
    device_serial     TEXT,
    agent_name        TEXT,
    contacted_person  TEXT,
    contact_phone     TEXT,
    follow_up_round   TEXT,
    outcome           TEXT,                     -- working|broken|lost|no_pos|working_tested
    comment           TEXT,
    called_at         DATE,
    attributes        JSONB NOT NULL DEFAULT '{}',
    source_ref        JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followups_merchant ON spos.call_followups (merchant_id);

-- ===========================================================================
-- GOLD — analytics views (the idea.md intelligence layer)
-- ===========================================================================

-- Latest telemetry per device.
CREATE OR REPLACE VIEW spos.v_device_latest_telemetry AS
SELECT DISTINCT ON (device_id)
       device_id, snapshot_at, device_status, connectivity, battery_level,
       signal_strength, last_access_time, latitude, longitude
FROM   spos.device_telemetry
WHERE  device_id IS NOT NULL
ORDER  BY device_id, snapshot_at DESC NULLS LAST;

-- POS health (Green/Yellow/Red) derived from latest telemetry if no score exists.
CREATE OR REPLACE VIEW spos.v_pos_health AS
SELECT d.id AS device_id, d.serial_number, d.terminal_id, d.current_merchant_id,
       COALESCE(h.health_bucket,
                CASE
                  WHEN t.device_status ILIKE 'online' OR t.device_status ILIKE 'active' THEN 'Green'
                  WHEN t.snapshot_at < now() - interval '7 days' THEN 'Red'
                  WHEN t.battery_level IS NOT NULL AND t.battery_level < 0.2 THEN 'Yellow'
                  ELSE 'Yellow'
                END) AS health_bucket,
       h.health_score, t.snapshot_at AS last_seen_at, t.battery_level
FROM   spos.pos_devices d
LEFT   JOIN spos.v_device_latest_telemetry t ON t.device_id = d.id
LEFT   JOIN LATERAL (
         SELECT health_score, health_bucket FROM spos.device_health_scores hs
         WHERE hs.device_id = d.id ORDER BY hs.as_of DESC NULLS LAST LIMIT 1
       ) h ON TRUE;

-- Device 360. health_bucket/score come from v_pos_health so they are consistent
-- with the dashboard (derived fallback when no explicit score exists).
CREATE OR REPLACE VIEW spos.v_device_360 AS
SELECT d.*,
       m.merchant_code, m.trading_name AS merchant_name,
       t.snapshot_at      AS last_seen_at,
       t.device_status    AS last_device_status,
       t.battery_level    AS last_battery_level,
       t.connectivity     AS last_connectivity,
       ph.health_score, ph.health_bucket
FROM   spos.pos_devices d
LEFT   JOIN spos.merchants m              ON m.id = d.current_merchant_id
LEFT   JOIN spos.v_device_latest_telemetry t ON t.device_id = d.id
LEFT   JOIN spos.v_pos_health ph          ON ph.device_id = d.id;

-- Merchant 360 (counts + rollups).
CREATE OR REPLACE VIEW spos.v_merchant_360 AS
SELECT m.*,
       b.name AS bank_name,
       (SELECT count(*) FROM spos.pos_devices d  WHERE d.current_merchant_id = m.id) AS device_count,
       (SELECT count(*) FROM spos.tickets tk     WHERE tk.merchant_id = m.id
                                                   AND tk.status NOT IN ('Closed','closed','resolved')) AS open_tickets,
       (SELECT coalesce(sum(s.total_transaction_amount),0)
          FROM spos.transaction_summaries s WHERE s.merchant_id = m.id) AS total_txn_amount,
       (SELECT coalesce(sum(s.total_transaction_count),0)
          FROM spos.transaction_summaries s WHERE s.merchant_id = m.id) AS total_txn_count
FROM   spos.merchants m
LEFT   JOIN spos.banks b ON b.id = m.bank_id;

-- Knowledge-graph edges (Merchant → POS → Bank → Officer → Ticket → Txn).
CREATE OR REPLACE VIEW spos.v_knowledge_graph_edges AS
  SELECT 'merchant'::text src_type, m.id src_id, 'bank'::text dst_type, m.bank_id dst_id, 'settles_with'::text rel
    FROM spos.merchants m WHERE m.bank_id IS NOT NULL
  UNION ALL
  SELECT 'merchant', d.current_merchant_id, 'device', d.id, 'operates'
    FROM spos.pos_devices d WHERE d.current_merchant_id IS NOT NULL
  UNION ALL
  SELECT 'merchant', m.id, 'employee', m.sales_officer_id, 'sold_by'
    FROM spos.merchants m WHERE m.sales_officer_id IS NOT NULL
  UNION ALL
  SELECT 'merchant', tk.merchant_id, 'ticket', tk.id, 'raised'
    FROM spos.tickets tk WHERE tk.merchant_id IS NOT NULL
  UNION ALL
  SELECT 'merchant', s.merchant_id, 'txn_summary', s.id, 'transacted'
    FROM spos.transaction_summaries s WHERE s.merchant_id IS NOT NULL;

-- ===========================================================================
-- Seed the column-alias dictionary (drives Phase-2 ETL). Aliases are stored
-- normalized: lower-case, non-alphanumerics collapsed to single spaces.
-- ===========================================================================
INSERT INTO spos.column_aliases (canonical_entity, canonical_field, source_alias) VALUES
 -- merchants
 ('merchants','merchant_code','merchant id'),
 ('merchants','merchant_code','merchantid'),
 ('merchants','merchant_code','pos mercant id'),
 ('merchants','merchant_code','mrc id'),
 ('merchants','qr_merchant_id','qr merchant id'),
 ('merchants','trading_name','mrc trading registered name'),
 ('merchants','trading_name','merchant license name'),
 ('merchants','trading_name','merchant licence name'),
 ('merchants','trading_name','trade name'),
 ('merchants','trading_name','merchant name'),
 ('merchants','phone','merchant phone number'),
 ('merchants','phone','merchant phone number owner'),
 ('merchants','phone','phone'),
 ('merchants','phone','phone number'),
 ('merchants','settlement_account','account number'),
 ('merchants','settlement_account','merchant settlemet bank account number'),
 ('merchants','settlement_account','mrc account'),
 ('merchants','address','address'),
 ('merchants','address','merchant address'),
 ('merchants','address','location'),
 ('merchants','address','merchant location'),
 ('merchants','branch','branch'),
 ('merchants','branch','branch name'),
 ('merchants','license_number','merchant license number'),
 ('merchants','gps_link','google maps location link'),
 ('merchants','contact_person','contact person'),
 ('merchants','contact_person','contacted person full name'),
 -- devices
 ('pos_devices','serial_number','pos serial number'),
 ('pos_devices','serial_number','serialnumber'),
 ('pos_devices','serial_number','serial number'),
 ('pos_devices','serial_number','device serial number'),
 ('pos_devices','serial_number','serial'),
 ('pos_devices','terminal_id','terminal id'),
 ('pos_devices','terminal_id','terminalid'),
 ('pos_devices','terminal_id','pos terminal id'),
 ('pos_devices','psn','psn'),
 ('pos_devices','model','manufacturingmodel'),
 ('pos_devices','model','model'),
 ('pos_devices','device_type','devicetype'),
 ('pos_devices','firmware_version','firmwareversion'),
 ('pos_devices','imei1','imei1'),
 ('pos_devices','imei2','imei2'),
 ('pos_devices','production_date','production date'),
 -- telemetry
 ('device_telemetry','device_status','devicestatus'),
 ('device_telemetry','device_status','device status'),
 ('device_telemetry','battery_level','batterylevel'),
 ('device_telemetry','battery_level','battery level'),
 ('device_telemetry','connectivity','connectivity'),
 ('device_telemetry','signal_strength','signal strength'),
 ('device_telemetry','last_access_time','lastaccesstime'),
 ('device_telemetry','last_access_time','latest date'),
 ('device_telemetry','cpu_usage','cpu usage'),
 ('device_telemetry','available_memory','available memory'),
 ('device_telemetry','available_storage','available storage'),
 ('device_telemetry','network_type','mobile data'),
 ('device_telemetry','ip','ip'),
 ('device_telemetry','latitude','latitude'),
 ('device_telemetry','longitude','longitude'),
 -- transaction summaries
 ('transaction_summaries','terminal_id','terminal id'),
 ('transaction_summaries','terminal_name','terminal name'),
 ('transaction_summaries','merchant_external_id','merchant id'),
 ('transaction_summaries','total_transaction_count','total transaction count'),
 ('transaction_summaries','total_transaction_amount','total transaction amount'),
 ('transaction_summaries','total_purchase_count','total purchase count'),
 ('transaction_summaries','total_purchase_amount','total purchase amount'),
 ('transaction_summaries','gateway_transaction_count','gateway transaction count'),
 ('transaction_summaries','gateway_transaction_amount','gateway transaction amount'),
 ('transaction_summaries','santimpay_commission','santimpay commission'),
 ('transaction_summaries','total_commission_br','total commission br'),
 ('transaction_summaries','total_commission_cut','totalcommissioncut'),
 -- transactions
 ('transactions','actual_amount','actual amount'),
 ('transactions','amount','amount'),
 ('transactions','transaction_type','transaction type'),
 ('transactions','payment_via','payment via'),
 ('transactions','pan_number','pan number'),
 ('transactions','invoice_number','invoice number'),
 ('transactions','created_at','created at'),
 ('transactions','created_at','createdat'),
 ('transactions','rrn','rrn'),
 ('transactions','stan','stan'),
 ('transactions','auth_id','authid'),
 ('transactions','response_code','response code'),
 -- sims
 ('sim_cards','sim_number','simcard no'),
 ('sim_cards','sim_number','simcard number'),
 ('sim_cards','msisdn','service number'),
 ('sim_cards','iccid','sim iccid'),
 ('sim_cards','service_type','service type'),
 ('sim_cards','customer_name','customer name')
ON CONFLICT (canonical_entity, source_alias) DO NOTHING;
