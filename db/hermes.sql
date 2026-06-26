-- ===========================================================================
-- Hermes — persistent memory & knowledge store
-- A dedicated `hermes` schema Hermes (the AI analyst) reads and writes across
-- sessions. Hermes's warehouse access stays READ ONLY (enforced in the app);
-- the only place she writes is here. Never store secrets in these tables.
-- Auto-loaded by docker-compose (db/ is mounted into initdb).
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS hermes;

-- Durable facts / insights / corrections, keyed by (kind, key) for upsert.
CREATE TABLE IF NOT EXISTS hermes.memory (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,                 -- e.g. 'fact','insight','preference','glossary'
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  context    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);

-- Append-only log of significant actions / observations.
CREATE TABLE IF NOT EXISTS hermes.events (
  id          BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,                -- e.g. 'merchant','device','question'
  entity_id   TEXT,
  action      TEXT NOT NULL,
  payload     JSONB,
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_kind    ON hermes.memory (kind);
CREATE INDEX IF NOT EXISTS idx_memory_updated ON hermes.memory (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_value   ON hermes.memory USING GIN (value);
CREATE INDEX IF NOT EXISTS idx_events_entity  ON hermes.events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON hermes.events (created_at DESC);

-- Keep memory.updated_at fresh on upsert.
CREATE OR REPLACE FUNCTION hermes.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memory_touch ON hermes.memory;
CREATE TRIGGER trg_memory_touch BEFORE UPDATE ON hermes.memory
  FOR EACH ROW EXECUTE FUNCTION hermes.touch_updated_at();
