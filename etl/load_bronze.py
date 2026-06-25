#!/usr/bin/env python3
"""
Phase 1 — Bronze (lossless) loader.

Walks data/, reads every sheet of every .csv/.xlsx/.xls, detects the header row,
and writes:
  spos.source_files   (one row per file)
  spos.source_sheets  (one row per sheet)
  spos.raw_rows       (one row per data row, payload as JSONB keyed by header)

Nothing is dropped: unmapped/odd columns all live in the JSONB. Re-runnable —
a file is skipped if its sha256 already loaded (use --force to reload).

Connection via standard PG* env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)
or DATABASE_URL.
"""
import os, sys, csv, glob, json, hashlib, argparse, datetime, re
from collections import Counter

import psycopg2
from psycopg2.extras import execute_values, Json

DATA_DIR = os.environ.get("SPOS_DATA_DIR", "data")
BATCH = 1000
KEEP_DUPES = False  # set by --keep-dupes


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def norm_header(h):
    if h is None:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", str(h).lower()).strip()


def jsonable(v):
    """Make a cell value JSON-serializable while preserving information."""
    if v is None:
        return None
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        # 913189156.0 -> "913189156" (these are IDs/phones, not real floats)
        return str(int(v))
    if isinstance(v, (int, float, bool)):
        return v
    return str(v).strip()


def make_keys(raw_headers):
    """Turn a header row into unique, non-empty dict keys, preserving order."""
    keys, seen = [], Counter()
    for i, h in enumerate(raw_headers):
        base = (str(h).strip() if h is not None and str(h).strip() else f"col_{i+1}")
        seen[base] += 1
        keys.append(base if seen[base] == 1 else f"{base}__{seen[base]}")
    return keys


def detect_header(rows, scan=15):
    """Header = the row (within first `scan`) with the most non-empty cells; >=2."""
    best_idx, best_n = None, 0
    for i, r in enumerate(rows[:scan]):
        n = sum(1 for c in r if c is not None and str(c).strip())
        if n > best_n:
            best_n, best_idx = n, i
    if best_idx is None or best_n < 2:
        # fall back to first non-empty row
        for i, r in enumerate(rows):
            if any(c is not None and str(c).strip() for c in r):
                return i
        return 0
    return best_idx


def row_nonempty(r):
    return any(c is not None and str(c).strip() for c in r)


# --------------------------------------------------------------------------- #
# Per-format readers -> list of (sheet_name, list_of_rows)
# --------------------------------------------------------------------------- #
def read_csv(path):
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rows = list(csv.reader(f))
    return [("(csv)", rows)]


def read_tsv(path):
    # Tab-separated dumps exported as .md/.txt (e.g. merchant registration sheets).
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    return [("(tsv)", rows)]


def read_xlsx(path):
    import openpyxl
    out = []
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        out.append((ws.title, [list(r) for r in ws.iter_rows(values_only=True)]))
    wb.close()
    return out


def read_xls(path):
    import xlrd
    out = []
    wb = xlrd.open_workbook(path)
    for ws in wb.sheets():
        rows = [[ws.cell_value(r, c) for c in range(ws.ncols)] for r in range(ws.nrows)]
        out.append((ws.name, rows))
    return out


READERS = {"csv": read_csv, "xlsx": read_xlsx, "xls": read_xls,
           "md": read_tsv, "txt": read_tsv}


# --------------------------------------------------------------------------- #
# DB
# --------------------------------------------------------------------------- #
def connect():
    if os.environ.get("DATABASE_URL"):
        return psycopg2.connect(os.environ["DATABASE_URL"])
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        port=os.environ.get("PGPORT", "5432"),
        user=os.environ.get("PGUSER", "postgres"),
        password=os.environ.get("PGPASSWORD", "postgres"),
        dbname=os.environ.get("PGDATABASE", "appdb"),
    )


def load_file(cur, path, force):
    fname = os.path.basename(path)
    ext = fname.rsplit(".", 1)[-1].lower()
    if ext not in READERS:
        return 0, 0

    raw = open(path, "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    st = os.stat(path)

    cur.execute("SELECT id, sha256 FROM spos.source_files WHERE filename=%s", (fname,))
    existing = cur.fetchone()
    if existing and existing[1] == sha and not force:
        return -1, -1  # already loaded, unchanged
    # Skip byte-identical duplicates loaded under a different name (the (1)/(2) files),
    # unless --keep-dupes is set. Bronze stays lossless w.r.t. distinct content.
    if not force and not KEEP_DUPES:
        cur.execute("SELECT 1 FROM spos.source_files WHERE sha256=%s AND filename<>%s LIMIT 1",
                    (sha, fname))
        if cur.fetchone():
            return -1, -1
    if existing:
        cur.execute("DELETE FROM spos.source_files WHERE id=%s", (existing[0],))  # cascade

    cur.execute(
        """INSERT INTO spos.source_files (filename, ext, sha256, size_bytes, file_mtime)
           VALUES (%s,%s,%s,%s,%s) RETURNING id""",
        (fname, ext, sha, st.st_size,
         datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc)),
    )
    file_id = cur.fetchone()[0]

    sheets_done = rows_done = 0
    for sheet_name, rows in READERS[ext](path):
        if not rows:
            cur.execute(
                """INSERT INTO spos.source_sheets
                   (file_id, sheet_name, header_row_index, header_signature, headers, ncols, nrows)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (file_id, sheet_name, None, "", Json([]), 0, 0),
            )
            sheets_done += 1
            continue

        hidx = detect_header(rows)
        raw_headers = rows[hidx]
        keys = make_keys(raw_headers)
        sig = "|".join(sorted(set(norm_header(h) for h in raw_headers if norm_header(h))))
        data_rows = [r for r in rows[hidx + 1:] if row_nonempty(r)]

        cur.execute(
            """INSERT INTO spos.source_sheets
               (file_id, sheet_name, header_row_index, header_signature, headers, ncols, nrows)
               VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (file_id, sheet_name, hidx, sig,
             Json([str(h) if h is not None else None for h in raw_headers]),
             len(keys), len(data_rows)),
        )
        sheet_id = cur.fetchone()[0]

        buf = []
        for ri, r in enumerate(data_rows):
            obj = {}
            for ci, key in enumerate(keys):
                val = jsonable(r[ci]) if ci < len(r) else None
                if val is not None and val != "":
                    obj[key] = val
            buf.append((sheet_id, ri, Json(obj)))
            if len(buf) >= BATCH:
                execute_values(cur,
                    "INSERT INTO spos.raw_rows (sheet_id,row_index,data) VALUES %s", buf)
                buf.clear()
        if buf:
            execute_values(cur,
                "INSERT INTO spos.raw_rows (sheet_id,row_index,data) VALUES %s", buf)

        sheets_done += 1
        rows_done += len(data_rows)
    return sheets_done, rows_done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="reload files even if unchanged")
    ap.add_argument("--keep-dupes", action="store_true",
                    help="also load byte-identical files saved under different names")
    ap.add_argument("--data-dir", default=DATA_DIR)
    args = ap.parse_args()
    global KEEP_DUPES
    KEEP_DUPES = args.keep_dupes

    files = sorted(glob.glob(os.path.join(args.data_dir, "*")))
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()

    tot_files = tot_sheets = tot_rows = skipped = 0
    for path in files:
        if not os.path.isfile(path):
            continue
        try:
            s, r = load_file(cur, path, args.force)
            if s == -1:
                skipped += 1
                continue
            conn.commit()
            tot_files += 1
            tot_sheets += s
            tot_rows += r
            print(f"  loaded {os.path.basename(path):60s} sheets={s:3d} rows={r}")
        except Exception as e:
            conn.rollback()
            print(f"  !! FAILED {os.path.basename(path)}: {e}", file=sys.stderr)

    cur.close()
    conn.close()
    print(f"\nDONE  files={tot_files}  skipped(unchanged)={skipped}  "
          f"sheets={tot_sheets}  rows={tot_rows}")


if __name__ == "__main__":
    main()
