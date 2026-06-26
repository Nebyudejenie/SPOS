# Hermes Onboarding — Database Access, Data Map & First Briefing

This document gives **Hermes** (the AI analyst in the *Ask Hermes* tab) everything she
needs to start working on the SPOS database: how she reaches it, what she may read and
write, the full data map, and a ready-to-paste briefing that tells her to learn the
system and **store what she learns in her own memory**.

> **One-line summary:** Hermes has **read access to the entire warehouse** and
> **read/write access to her own `hermes` memory schema**. She works through the
> *Ask Hermes* chat — you don't give her a raw DB password; the backend already holds
> the connection and exposes safe tools.

---

## 1. Where the data lives

| Thing | Value |
|---|---|
| Database | `appdb` (PostgreSQL 16) |
| Warehouse schema (read-only for Hermes) | `spos` |
| Hermes memory schema (read/write) | `hermes` |
| Backend API | `http://localhost:4000` (Hermes endpoint: `POST /api/hermes/ask`) |
| Frontend (Ask Hermes tab) | `http://localhost:8090` |
| Requirement to enable Hermes | `ANTHROPIC_API_KEY` set on the backend |

Hermes does **not** open her own database connection. The Express backend owns the
connection pool and exposes four safe tools to her (below). This is the security boundary.

---

## 2. What Hermes is allowed to do (permissions)

| Scope | Permission | How |
|---|---|---|
| `spos.*` (all merchant/device/transaction data + gold views) | **READ ONLY** | her `run_sql` tool runs inside a `READ ONLY` transaction with an 8s timeout; writes/DDL are rejected |
| `hermes.memory`, `hermes.events` | **READ + WRITE** | her `remember`, `recall`, `log_event` tools (fixed, parameterized — no arbitrary SQL) |
| Secrets (passwords, API keys, tokens) | **NEVER store** | enforced by policy in her system prompt |

This matches the stated requirement: *full read of the data and full ownership of her
own memory schema — but not destructive write access to the merchant data.*

---

## 3. Hermes's tools (already wired in)

- **`run_sql(query)`** — run one read-only `SELECT`/`WITH` over `spos.*` or `hermes.*` (max 200 rows).
- **`recall(kind?, key?, search?)`** — read her persistent memory.
- **`remember(kind, key, value, context?)`** — store/update a durable fact (upsert by `kind`+`key`).
- **`log_event(entity_type, action, entity_id?, payload?, source?)`** — append to her event log.

Her most recent memory is auto-injected into every chat, so she starts each session informed.

Inspect her memory anytime (read-only):
```bash
curl http://localhost:4000/api/hermes/memory
# or filter:  /api/hermes/memory?kind=glossary   /api/hermes/memory?search=bank
```

---

## 4. The data map (what she can analyze)

**Gold views (prefer these):**
- `spos.v_merchant_360` — merchant + bank, region, device_count, open_tickets, total_txn_amount/count
- `spos.v_device_360` — device + merchant, last_seen, battery, connectivity, health_bucket/score
- `spos.v_pos_health` — per-device Green/Yellow/Red
- `spos.v_merchant_health` — per-merchant health score + bucket + contributing counts
- `spos.v_knowledge_graph_edges` — merchant→bank/officer/device/ticket/txn edges

**Core tables:** `spos.merchants`, `spos.banks`, `spos.pos_devices`, `spos.device_telemetry`,
`spos.transaction_summaries`, `spos.transactions`, `spos.settlements`,
`spos.device_assignments`, `spos.call_followups`, `spos.sim_cards`.

**Her memory:** `hermes.memory` (kind, key, value, context), `hermes.events` (entity_type, action, payload).

Current scale: ~9,100 merchants · ~9,760 devices · ~113k transactions · ~47k txn summaries.
Money is in **Ethiopian Birr**. `merchant_code` (SP…) is the POS merchant ID, distinct from `qr_merchant_id`.

---

## 5. Direct database access (for you, the operator)

Hermes uses the tools above; you can also reach the DB directly for admin/verification.

**In Docker (deploy / compose):**
```bash
# open a SQL shell in the database container (compose service name: db)
docker compose exec db psql -U postgres -d appdb

# apply / re-apply schema (idempotent) — warehouse + hermes memory:
docker compose exec -T db psql -U postgres -d appdb -f /docker-entrypoint-initdb.d/init.sql
docker compose exec -T db psql -U postgres -d appdb -f /docker-entrypoint-initdb.d/warehouse.sql
docker compose exec -T db psql -U postgres -d appdb -f /docker-entrypoint-initdb.d/hermes.sql
```

**Local (psql installed, DB on localhost):**
```bash
psql -d appdb -f db/init.sql
psql -d appdb -f db/warehouse.sql
psql -d appdb -f db/hermes.sql
```

**Quick checks:**
```sql
-- Hermes can see her memory
SELECT kind, key FROM hermes.memory ORDER BY kind, key;
-- top merchants by volume
SELECT trading_name, total_txn_amount FROM spos.v_merchant_360 ORDER BY total_txn_amount DESC LIMIT 5;
-- merchant health distribution
SELECT health_bucket, count(*) FROM spos.v_merchant_health GROUP BY 1;
```

---

## 6. ▶️ Paste this into the "Ask Hermes" chat to brief her

Copy the block below into the Ask Hermes box as your first message. It grants context,
points her at the data, and tells her to **store what she learns in her memory**.

```
You are Hermes, the analyst for our SPOS (Smart-POS) operation in Ethiopia. You have
read-only access to the whole warehouse (schema "spos") and read/write access to your own
memory (schema "hermes"). Money is in Ethiopian Birr.

Onboarding task — do this now:
1) recall what you already know.
2) Explore the warehouse with run_sql to learn its shape: list the gold views
   (v_merchant_360, v_device_360, v_pos_health, v_merchant_health) and the core tables,
   and get row counts and the merchant-health and POS-health distributions.
3) For each durable thing you learn — what a table/view means, key columns, useful
   metrics, the merchant_code vs qr_merchant_id distinction, bank name spellings — call
   remember(kind, key, value) so future sessions start informed. Use kind="glossary" for
   definitions, kind="insight" for findings, kind="fact" for stable numbers.
4) log_event(entity_type="onboarding", action="completed", payload={...}) when done.

Rules: never store secrets (passwords, API keys, tokens) in memory. Do not attempt to
write to the spos warehouse — it is read-only; your only writable space is the hermes schema.

When finished, summarize what you learned and what you stored in memory.
```

After that, ask her real questions, e.g.:
- "Which merchants are Red and why?"
- "Top 5 banks by transaction volume."
- "How many POS devices haven't reported in over 7 days?"
- "Remember that Awash Bank settlements are reviewed weekly." (tests her memory)

---

## 7. Security rules (do not relax without intent)
- Keep warehouse access **read-only**; Hermes writes only to `hermes`.
- **No secrets** in `hermes.memory` — it is knowledge, not a credential store.
- Set a real `DB_PASSWORD` and a restricted `CORS_ORIGIN` in `.env` before production.
- The API has **no auth** yet — put it behind a login or private network before public exposure.
