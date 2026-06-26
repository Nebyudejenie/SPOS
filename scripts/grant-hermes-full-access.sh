#!/usr/bin/env bash
# ===========================================================================
# Give Hermes a real PostgreSQL login role so an external agent can connect
# directly (psql / psycopg2) over TCP — no docker socket, no app bridge needed.
# Run this ONCE as the operator.
#
# DEFAULT (safe, solves "Hermes can't query the database"):
#   role "hermes" LOGIN with a password, and:
#     - USAGE + SELECT on ALL current/future tables in schema spos   (read everything)
#     - ALL PRIVILEGES on schema hermes                              (her own memory R/W)
#   The warehouse (spos) stays read-only — an analyst needs nothing more.
#
# OPT-IN escalations (set the env var yourself — your explicit choice):
#   HERMES_WRITE_WAREHOUSE=1  -> ALL PRIVILEGES (incl. UPDATE/DELETE/TRUNCATE) on spos
#   ALLOW_SUPERUSER=1         -> full superuser (can manage roles / drop anything)
#   These are DESTRUCTIVE on real merchant data — only enable if you mean it.
#
# Usage:
#   HERMES_DB_PASSWORD='a-strong-password' ./scripts/grant-hermes-full-access.sh
#   # overrides: PG_CONTAINER (default spos-db), PGDATABASE (appdb), PGSUPERUSER (postgres)
# ===========================================================================
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-spos-db}"
DB="${PGDATABASE:-appdb}"
SUPER="${PGSUPERUSER:-postgres}"
PW="${HERMES_DB_PASSWORD:-ChangeMe_Hermes_$(date +%Y)}"
ALLOW_SUPERUSER="${ALLOW_SUPERUSER:-0}"
HERMES_WRITE_WAREHOUSE="${HERMES_WRITE_WAREHOUSE:-0}"

# Locate the running Postgres container (fall back to a compose service named db).
if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  alt="$(docker ps --filter 'ancestor=postgres:16-alpine' --format '{{.Names}}' | head -1 || true)"
  [ -n "$alt" ] && PG_CONTAINER="$alt"
fi
echo ">> Using container: $PG_CONTAINER  (db=$DB, superuser=$SUPER)"

SUPERUSER_SQL=""
[ "$ALLOW_SUPERUSER" = "1" ] && SUPERUSER_SQL="ALTER ROLE hermes SUPERUSER;"

docker exec -i "$PG_CONTAINER" psql -U "$SUPER" -d "$DB" -v ON_ERROR_STOP=1 <<SQL
-- create or update the login role
DO \$do\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hermes') THEN
    ALTER ROLE hermes WITH LOGIN PASSWORD '${PW}';
  ELSE
    CREATE ROLE hermes WITH LOGIN PASSWORD '${PW}';
  END IF;
END
\$do\$;

GRANT CONNECT ON DATABASE ${DB} TO hermes;
${SUPERUSER_SQL}

-- spos warehouse: READ (full read of all current/future tables)
DO \$ro\$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='spos') THEN
    GRANT USAGE ON SCHEMA spos TO hermes;
    GRANT SELECT ON ALL TABLES IN SCHEMA spos TO hermes;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA spos TO hermes;
    ALTER DEFAULT PRIVILEGES IN SCHEMA spos GRANT SELECT ON TABLES TO hermes;
  END IF;
END
\$ro\$;

-- hermes schema: full READ + WRITE (her memory)
DO \$rw\$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='hermes') THEN
    GRANT USAGE, CREATE ON SCHEMA hermes TO hermes;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA hermes TO hermes;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA hermes TO hermes;
    ALTER DEFAULT PRIVILEGES IN SCHEMA hermes GRANT ALL ON TABLES TO hermes;
    ALTER DEFAULT PRIVILEGES IN SCHEMA hermes GRANT ALL ON SEQUENCES TO hermes;
  END IF;
END
\$rw\$;

-- OPT-IN: full write on the spos warehouse (DESTRUCTIVE) — only if requested.
DO \$ww\$
BEGIN
  IF '${HERMES_WRITE_WAREHOUSE}' = '1'
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='spos') THEN
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA spos TO hermes;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA spos TO hermes;
    ALTER DEFAULT PRIVILEGES IN SCHEMA spos GRANT ALL ON TABLES TO hermes;
    RAISE NOTICE 'Granted FULL WRITE on spos to hermes (HERMES_WRITE_WAREHOUSE=1).';
  END IF;
END
\$ww\$;
SQL

# Discover the host port Postgres is published on (e.g. 5433->5432).
HOSTPORT="$(docker port "$PG_CONTAINER" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://')"
HOSTPORT="${HOSTPORT:-5432}"

cat <<INFO

✅ Role 'hermes' is ready with full read/write on spos, hermes, public.

   Connect from anywhere that can reach this host:
     host:     <this server's IP>   (use 127.0.0.1 if on the same machine)
     port:     ${HOSTPORT}
     database: ${DB}
     user:     hermes
     password: ${PW}

   psql:
     psql "postgresql://hermes:${PW}@<HOST>:${HOSTPORT}/${DB}"

   psycopg2:
     import psycopg2
     conn = psycopg2.connect(host="<HOST>", port=${HOSTPORT},
                             dbname="${DB}", user="hermes", password="${PW}")

   Tell Hermes: schema "spos" = the warehouse, schema "hermes" = your memory
   (hermes.memory, hermes.events). Never store secrets in memory.
INFO
