#!/usr/bin/env bash
# ===========================================================================
# Restore the SPOS database from a compressed dump (db/seed/spos_seed.sql.gz).
# Loads spos (+ hermes) schemas with data — the app and Hermes work immediately,
# no ETL / source files / Python needed. The dump is --clean, so it drops &
# recreates those schemas before loading (safe to re-run).
#
# Pick the target Postgres:
#   COMPOSE=1  -> docker compose service "db"   (deploy)         [recommended]
#   default    -> container named by PG_CONTAINER (dev: spos-db)
#
# Usage:
#   COMPOSE=1 ./scripts/restore-db.sh                 # into compose db
#   ./scripts/restore-db.sh                           # into spos-db
#   SEED=/path/to/dump.sql.gz ./scripts/restore-db.sh # custom dump file
#   overrides: PGDATABASE (appdb), PGUSER (postgres), PG_CONTAINER (spos-db)
# ===========================================================================
set -euo pipefail

SEED="${SEED:-db/seed/spos_seed.sql.gz}"
DB="${PGDATABASE:-appdb}"
USER="${PGUSER:-postgres}"
[ -f "$SEED" ] || { echo "!! dump not found: $SEED (run ./scripts/dump-db.sh first, or set SEED=)"; exit 1; }

echo ">> Restoring $SEED -> database $DB"
if [ "${COMPOSE:-0}" = "1" ]; then
  gunzip -c "$SEED" | docker compose exec -T db psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1
else
  gunzip -c "$SEED" | docker exec -i "${PG_CONTAINER:-spos-db}" psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=1
fi
echo "✅ restore complete."
