# SPOS Data Model & Ingestion Plan

> Deep analysis of the 372 source files in [data/](data/) and the database design to store **all** of it
> in a flexible, lossless, query-able way.

---

## 1. What is actually in `data/` (evidence, not guesses)

- **372 files**: 241 `.xlsx`, 130 `.csv`, 1 `.xls`
- **1,595 sheets** total (workbooks have many tabs); **1,554 non-empty**, 41 empty
- **≥ 262,945 data rows** (row counts are capped at ~2,000/sheet during profiling, so this is a lower bound — e.g. `SHOA_REPORT_all_transaction_pos.csv` alone has ~43,000 rows)
- **360 distinct header signatures** — i.e. the data is *messy*: the same concept appears under many column names, headers aren't always in row 1, many junk/`Untitled`/duplicate `(1)(2)` files exist.

Profiling was done with a throwaway script that dumps every file/sheet's headers + a sample row to `scratch_profile.json` (git-ignored — it embeds real merchant sample data; regenerate locally if needed).

### The dominant, recurring templates (the "source of truth" schemas)

| # | Template (what it is) | Scale | Key columns |
|---|------------------------|-------|-------------|
| 1 | **Daily POS device snapshot** (the `9_x`/`10_x` daily CSVs + `pos-device-report` + `terminals-report`) | **364 sheets / ~8.7k+ rows** | `terminalid, serialnumber, mobileserialnumber, merchantid, devicetype, manufacturingmodel, firmwareversion, hardwareversion, pciversion, profileversion, devicestatus, batterylevel, connectivity, lastaccesstime, status, createdat, city, subcity, woreda, latitude, longitude` |
| 2 | **Key merchant transaction summary** (daily `key-merchant-transactions`) | **180 + 24 sheets / ~45k rows** | `merchant id, terminal id, terminal name, total transaction count/amount, total purchase count/amount, gateway transaction count/amount, santimpay commission, total commission br, totalcommissioncut` |
| 3 | **Rich device info** (`POS_Device_Info`, TopWise device-management export) | 5 sheets / ~10.8k rows | `imei1, imei2, sim iccid, model, psn, battery level, signal strength, cpu usage, available memory/storage, network type, latitude, longitude, app info, latest date` |
| 4 | **Derived POS health** (`derived_pos_health`) | 3 sheets / ~6.8k rows | `psn, health score, health bucket, last seen hrs, battery level, signal strength, cpu usage, device status` |
| 5 | **Raw transactions** (`SHOA_REPORT_all_transaction_pos`, `edit txn`, campaign txn) | ~45k+ rows | `account number, actual amount, created at, invoice number, pan number, payment via, status, terminal id, terminal name, transaction type, rrn, stan, authid, void, settled` |
| 6 | **Settlement** (`Settlement_`) | 54 sheets / ~7.2k rows | `amount, date time, merchant, response code, rrn, settled, stan, status, type, void` |
| 7 | **Bank statements / CDR** (`Bank 2018`, `Santimpay October CDR`) | thousands | `credit, debit, date, narrative, particulars, reference, value date` |
| 8 | **Deployment / activation forms** (Google Form responses) | many | `timestamp, email, santimpay employee, merchant license name, merchant phone, terminal id, device serial number, bank name, bank account number, gps link, received by, branches` |
| 9 | **Merchant master / recruiting** (`Merchant Registration_`, bank lists: AWASH/CBE/Geda/Oromia) | thousands | `merchant id (SP…), MRC TRADING/REGISTERED NAME, qr merchant id, branch, pos terminal id, pos serial number, bank name, account number, location, phone, status, production date` |
| 10 | **SIM cards** (`Santimpay Mobile postpaid`, `Ethio telecom SIM`) | ~3.2k rows | `customer name, service number (msisdn), service type, sn, status, simcard no, iccid` |
| 11 | **Returned / replaced devices** (`Returned/Returend POS…`, `SP POS Dashboard`, `Account Replecment`) | thousands | `terminal id, serial, status (NO COVER/NO CHARGER…), recived by, month, previous/replaced bank+account` |
| 12 | **Call-center follow-up & tickets** (`Call Center POS Follow UP`, `2026 POS Phone Call FollowUp`, `IT_Tickets`) | thousands | `name, merchant license name, device serial, follow up round, contacted person, comment` / `ticket id, user, issue, category, fix, status, date` |

### Identifiers seen across files (these become the join keys)
- **Merchant code**: `SP002221`, `SP0000000002600` (zero-padded variant) → `merchant_code`
- **QR Merchant ID**: e.g. `396973`, `171024` → `qr_merchant_id`
- **POS Terminal ID**: `TP100234`, also `SP002xxx` used as terminal id in some sheets
- **Serial number**: `P390900034514` (P-series) and `S3909117500001486` (S-series)
- **PSN**: device-management serial used by health export
- **SIM / MSISDN**: `251951946818`, ICCID

---

## 2. Design principle — "flexible like genius": a 3-layer (medallion) model

Because the sources are inconsistent and **every row matters**, the database is layered so nothing is ever
lost while still giving clean, typed, relational tables for analytics.

```
   data/ (372 files)
        │  generic loader (lossless)
        ▼
┌──────────────────────────────┐
│  BRONZE  — raw staging        │  every sheet + every row stored verbatim as JSONB
│  source_files / source_sheets │  + full provenance (file, sheet, row index)
│  raw_rows (data JSONB)        │  → ANY schema ingests, zero data loss
└──────────────┬───────────────┘
               │  mapping dictionary (column_aliases) + ETL
               ▼
┌──────────────────────────────┐
│  SILVER  — curated entities   │  typed canonical tables, each with an
│  merchants, pos_devices,      │  `attributes JSONB` overflow column so
│  transactions, telemetry, …   │  unexpected columns are still preserved,
│                               │  plus `source_ref` lineage back to bronze
└──────────────┬───────────────┘
               │  views
               ▼
┌──────────────────────────────┐
│  GOLD  — analytics & graph    │  merchant_360, device_360, pos_health,
│  views + knowledge-graph edges│  churn/▲ insights (the idea.md vision)
└──────────────────────────────┘
```

Why this is the right ("genius") design:
- **Lossless**: the bronze layer captures all 262k+ rows of all 360 schemas as JSONB — you can always re-derive.
- **Flexible**: every curated table has `attributes JSONB` (GIN-indexed) → new/odd columns never break ingestion.
- **Traceable**: every curated row carries `source_ref` (file → sheet → row) for audit.
- **Relational where it counts**: merchants ↔ devices ↔ transactions ↔ tickets are real foreign keys → enables the idea.md **knowledge graph** and health scoring.
- **Identity resolution built in**: merchants matched by `merchant_code | qr_merchant_id | phone`; devices by `serial_number | terminal_id | psn`.

All warehouse objects live in a dedicated PostgreSQL schema **`spos`** so they never collide with the CRUD
app's `public` tables.

---

## 3. Entities (silver layer)

| Table | Grain | Sourced from templates |
|-------|-------|------------------------|
| `spos.banks` | one bank | all bank-name columns |
| `spos.employees` | sales/activation/encoder/call-center staff | emails, "SantimPay Employee", "Sales Name", "Recruited by" |
| `spos.merchants` | one merchant (canonical) | #9, #8, recruiting forms, bank lists |
| `spos.bank_accounts` | merchant↔settlement account (+ replacement history) | #11 `Account Replecment`, recruiting |
| `spos.sim_cards` | one SIM | #10 |
| `spos.pos_devices` | one physical device | #1, #3, master lists, stock |
| `spos.device_assignments` | deploy/return/replace/handover **event** | #8, #11 deployment & return forms |
| `spos.device_telemetry` | device snapshot per time | #1, #3 (time-series) |
| `spos.device_health_scores` | device health as-of date | #4 |
| `spos.transactions` | one transaction | #5 |
| `spos.transaction_summaries` | per-terminal/day aggregate + commission | #2 |
| `spos.settlements` | one settlement record | #6, #7 |
| `spos.tickets` | one support/IT ticket | #12 IT_Tickets |
| `spos.call_followups` | one call-center follow-up | #12 phone follow-ups |
| `spos.column_aliases` | dictionary: messy header → canonical field | drives the ETL |

Full DDL: [db/warehouse.sql](db/warehouse.sql).

---

## 4. Gold layer (the idea.md intelligence)

Views over the silver layer:
- `spos.v_merchant_360` — merchant + its devices, accounts, latest health, txn totals, open tickets.
- `spos.v_device_360` — device + current merchant + latest telemetry + health + assignment history.
- `spos.v_pos_health` — device health bucket (Green/Yellow/Red) from telemetry + score.
- `spos.v_merchant_health` — composite merchant health (txn activity + device uptime + tickets + settlement).
- `spos.v_knowledge_graph_edges` — Merchant→POS→Bank→Officer→Ticket→Transaction edges for the graph.

---

## 5. Phased plan

**Phase 0 — Schema (this delivery).** Create `spos` schema: bronze + silver + gold DDL, indexes, alias dictionary seeded. → `db/warehouse.sql`.

**Phase 1 — Bronze load (lossless). ✅ DONE.** The generic loader [etl/load_bronze.py](etl/load_bronze.py) walks `data/`, detects the header row per sheet, and writes `source_files`, `source_sheets`, and one `raw_rows` JSONB row per data row. **Result: 372 files / 1,595 sheets / 358,862 rows loaded, 0 failures** — 100% of the data in Postgres, query-able immediately, nothing lost. (Row count exceeds the profiling estimate because profiling capped sheets at ~2,000 rows; the loader takes everything — e.g. SHOA's full 43,046 rows.)

**Phase 2 — Silver ETL. ✅ DONE.** [etl/build_silver.py](etl/build_silver.py) maps the bronze JSONB into the typed tables via the field dictionary, normalizes ids/dates/amounts, resolves identities (merchants by `merchant_code | qr_merchant_id | trading_name+phone`; devices by `serial_number | terminal_id | psn`), and stamps every row with `source_ref`. Unmapped columns are preserved per-row in `attributes`. Re-runnable (truncates silver, re-derives from bronze).

Result (distinct rows landed):

| table | rows | | table | rows |
|-------|-----:|-|-------|-----:|
| merchants | 10,519 | | transactions | 112,861 |
| pos_devices | 9,762 | | transaction_summaries | 47,200 |
| device_telemetry | 33,388 | | settlements | 6,974 |
| device_health_scores | 8,367 | | sim_cards | 10,739 |
| banks | 273 | | employees | 175 |

Gold views verified live: `v_merchant_360` ranks merchants by transaction volume, `v_pos_health` produces Green/Yellow/Red buckets, and `v_knowledge_graph_edges` yields ~60k edges (transacted 45.7k, operates 6.4k, settles_with 4.9k, sold_by 3.4k).

**Phase 3 — Gold + app. ✅ DONE.** Read-only warehouse API in the backend ([backend/src/routes/warehouse.js](backend/src/routes/warehouse.js)) over the gold views, and a React analytics UI (Dashboard + Merchant/Device explorers with detail drawers):

| Endpoint | Returns |
|----------|---------|
| `GET /api/wh/summary` | KPIs, POS-health distribution, merchants-by-bank/region, top merchants, txn volume by bank |
| `GET /api/wh/merchants` | paged/searchable list from `v_merchant_360` |
| `GET /api/wh/merchants/:id` | merchant + its devices, accounts, tickets, txn summaries |
| `GET /api/wh/devices` | paged list from `v_device_360` (filter by health bucket) |
| `GET /api/wh/devices/:id` | device + telemetry history |

Verified end-to-end (browser → vite proxy → Express → Postgres): dashboard shows 10,519 merchants / 9,762 devices / Green-Yellow-Red health, and bank canonicalization collapsed the spelling variants (CBE 2,231 · Oromia 976 · Lion 763 · …).

**Phase 4 — Dedup & quality. ✅ mostly done.**
- **Bank canonicalization** — `BANK_CANON` in [etl/build_silver.py](etl/build_silver.py) collapses spelling variants (CBE 2,231 · Oromia 976 · Lion 763 · …).
- **Duplicate-file skip** — [etl/load_bronze.py](etl/load_bronze.py) skips byte-identical `(1)/(2)` files by `sha256` (override with `--keep-dupes`).
- **Lifecycle + support extractors** — deployments/returns and call-center follow-ups are now populated: `device_assignments` (20,285 deploy + 2,720 return) and `call_followups` (2,757), surfaced in the merchant detail UI. (`tickets` stays 0 — the only ticket file has no data rows.)
- **Merchant dedup** — [etl/dedup_merchants.py](etl/dedup_merchants.py) conservatively merges duplicate merchants, re-pointing every child row first. Base pass: name-only records absorbed into their canonical (coded) twin or merged on (name + phone). Opt-in `--fuzzy` pass: distinctive same-name records that also share a second signal (phone/city/region/account/QR) — generic names ("Pharmacy") and same-name-without-a-shared-signal records are deliberately left apart. Result: **10,519 → 9,105** merchants, zero orphaned FKs, idempotent on re-run. Distinct coded merchants are never merged into each other.

A one-command runner ties it together — see [Makefile](Makefile): `make pipeline` brings up the stack, waits for Postgres, and runs the full ETL (bronze → silver → dedup).

---

## 6. How to run (once ETL is built)

```bash
# 0. schema is applied automatically by docker-compose (db/ is mounted into initdb)
docker compose up --build

# 1. set up the ETL environment
python3 -m venv .venv && .venv/bin/pip install -r etl/requirements.txt

# 2. bronze load (Phase 1) — point PG* at your database, then run
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=appdb
.venv/bin/python etl/load_bronze.py          # walks data/, fills spos.raw_rows (re-runnable)

# 3. silver ETL (Phase 2)
.venv/bin/python etl/build_silver.py        # maps bronze -> typed tables (re-runnable)
```
