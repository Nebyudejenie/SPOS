#!/usr/bin/env bash
# ===========================================================================
# Dump the loaded SPOS database to a portable compressed file, so you can
# restore the whole warehouse + Hermes memory on another machine WITHOUT the
# 372 source files or Python. Run on the machine that already has data.
#
# Output: db/seed/spos_seed.sql.gz   (git-ignored — contains merchant PII;
#         transfer it privately, e.g. scp, never commit to a public repo)
#
#   Default: curated (spos silver + gold views + hermes memory, no bronze) ~17MB
#   FULL=1 : include bronze raw_rows (lossless provenance)                 ~32MB
#
# Usage:  ./scripts/dump-db.sh            # curated
#         FULL=1 ./scripts/dump-db.sh     # with bronze
#   overrides: PG_CONTAINER (default spos-db), PGDATABASE (appdb), PGUSER (postgres)
# ===========================================================================
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-spos-db}"
DB="${PGDATABASE:-appdb}"
USER="${PGUSER:-postgres}"
FULL="${FULL:-0}"
OUT="db/seed/spos_seed.sql.gz"
mkdir -p "$(dirname "$OUT")"

EXCLUDE=()
if [ "$FULL" != "1" ]; then
  EXCLUDE=(-T 'spos.source_files' -T 'spos.source_sheets' -T 'spos.raw_rows')
  echo ">> Dumping CURATED (spos curated + views + hermes; no bronze)"
else
  echo ">> Dumping FULL warehouse (incl bronze raw_rows)"
fi

docker exec "$PG_CONTAINER" pg_dump -U "$USER" -d "$DB" --clean --if-exists \
  -n spos -n hermes "${EXCLUDE[@]}" | gzip > "$OUT"

echo "✅ wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "   restore with:  ./scripts/restore-db.sh   (see that script for targets)"
