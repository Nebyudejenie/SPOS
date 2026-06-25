# SPOS — Smart POS Merchant & Device Management

A production-ready CRUD application for managing **merchants** and **POS devices**, built from `idea.md`.

- **Frontend:** React 18 + Vite, Axios, served by nginx in production
- **Backend:** Node.js 20 + Express (REST API, validation, logging, error handling)
- **Database:** PostgreSQL 16
- **Orchestration:** Docker + Docker Compose with health checks and a persistent DB volume

### Two things live here
1. **The CRUD app** (this README) — React + Express + Postgres + Docker, the `idea.md` baseline.
2. **The SPOS data warehouse** — a flexible 3-layer (bronze/silver/gold) model in the `spos`
   schema that ingests **all 372 source files** in [data/](data/) (≥358k rows) losslessly, then
   curates them into typed, related tables and analytics views. The React frontend is now an
   **analytics explorer** (Dashboard + Merchant/Device browsers) over that warehouse via the
   `/api/wh/*` endpoints. See **[DATA_MODEL.md](DATA_MODEL.md)** for the design, ingestion plan,
   and run instructions, and [etl/](etl/) for the loaders.

---

## Quick start (Docker — recommended)

```bash
# 1. From the project root, copy the env template
cp .env.example .env

# 2. Build and start all three services
docker compose up --build

# 3. Open the app
#    Frontend  -> http://localhost:8080
#    Backend   -> http://localhost:4000/health
```

### Full pipeline in one command

To also ingest all 372 files in [data/](data/) into the `spos` warehouse (bronze + silver):

```bash
make pipeline     # up + wait for Postgres + load_bronze + build_silver
make psql         # poke around: SELECT * FROM spos.v_merchant_360 LIMIT 5;
```

`make` auto-detects `docker compose` (v2) or `docker-compose` (legacy). See `make help` for all targets.

The database is seeded on first run with the example merchant (`SP002221`) and POS device (`TP100234`) from `idea.md`.

Stop everything:

```bash
docker compose down          # keep data
docker compose down -v       # also delete the Postgres volume (fresh DB next time)
```

---

## Local development (without Docker)

You need Node.js 20+ and a running PostgreSQL with database `appdb`.

```bash
# Backend
cd backend
cp .env.example .env          # adjust DB_* if needed
npm install
npm run dev                   # http://localhost:4000

# Frontend (second terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173 (proxies /api -> :4000)
```

To create the schema manually against a local DB:

```bash
psql -d appdb -f db/init.sql
```

---

## API reference

Base URL: `http://localhost:4000/api`

### Health
| Method | Path             | Purpose                          |
|--------|------------------|----------------------------------|
| GET    | `/health`        | Liveness (process up)            |
| GET    | `/health/ready`  | Readiness (DB reachable)         |

### Merchants — `/api/merchants`
| Method | Path        | Body              | Description                         |
|--------|-------------|-------------------|-------------------------------------|
| GET    | `/`         | —                 | List all (filters: `search`, `region`, `status`) |
| GET    | `/:id`      | —                 | Get one by UUID                     |
| POST   | `/`         | merchant JSON     | Create (`merchant_code`, `merchant_name` required) |
| PUT    | `/:id`      | merchant JSON     | Update                              |
| DELETE | `/:id`      | —                 | Delete                              |

### POS devices — `/api/pos-devices`
| Method | Path        | Body              | Description                         |
|--------|-------------|-------------------|-------------------------------------|
| GET    | `/`         | —                 | List all (filters: `search`, `status`, `merchant_id`) |
| GET    | `/:id`      | —                 | Get one by UUID                     |
| POST   | `/`         | device JSON       | Create (`terminal_id` required)     |
| PUT    | `/:id`      | device JSON       | Update                              |
| DELETE | `/:id`      | —                 | Delete                              |

Example:

```bash
curl -X POST http://localhost:4000/api/merchants \
  -H 'Content-Type: application/json' \
  -d '{"merchant_code":"SP003000","merchant_name":"Sunrise Pharmacy","region":"Addis Ababa","bank":"Awash Bank"}'
```

Responses wrap data as `{ "data": ... }`; list endpoints also return `count`. Validation failures return `422` with a `details` array; duplicates return `409`; unknown IDs return `404`.

---

## Project structure

```
offic-SPOS/
├── docker-compose.yml        # Orchestrates db + backend + frontend, health checks, volume
├── .env.example              # Compose-level env (DB creds, ports)
├── .gitignore
├── README.md
├── idea.md                   # Original specification
│
├── db/
│   └── init.sql              # Schema (merchants, pos_devices), triggers, seed data
│
├── backend/
│   ├── Dockerfile            # Node 20 alpine image + container health check
│   ├── .dockerignore
│   ├── .env.example          # Backend env template
│   ├── package.json
│   └── src/
│       ├── index.js          # Entry: waits for DB, starts server, graceful shutdown
│       ├── app.js            # Express app: middleware, routes, health, error handling
│       ├── config/
│       │   └── db.js         # pg Pool, query helper, waitForDatabase, closePool
│       ├── middleware/
│       │   ├── errorHandler.js  # ApiError class, notFound, central error handler
│       │   └── validate.js      # Runs express-validator results -> 422
│       ├── validators/
│       │   ├── merchantValidator.js   # express-validator rule chains
│       │   └── posDeviceValidator.js
│       ├── controllers/
│       │   ├── merchantController.js   # CRUD against merchants
│       │   └── posDeviceController.js  # CRUD against pos_devices
│       ├── routes/
│       │   ├── merchants.js   # Wires rules + controllers to paths
│       │   └── posDevices.js
│       └── utils/
│           ├── logger.js      # Dependency-free JSON logger (LOG_LEVEL gated)
│           └── asyncHandler.js# Forwards async errors to Express
│
└── frontend/
    ├── Dockerfile            # Multi-stage: build with Node, serve with nginx
    ├── nginx.conf            # Serves SPA + proxies /api -> backend
    ├── .dockerignore
    ├── .env.example
    ├── index.html
    ├── vite.config.js        # React plugin + dev proxy
    ├── package.json
    └── src/
        ├── main.jsx          # React entry
        ├── App.jsx           # Tabbed shell, state, CRUD orchestration, toasts
        ├── styles.css        # Responsive styling
        ├── api/
        │   └── client.js     # Axios instance + merchants/posDevices API wrappers
        └── components/
            ├── Toast.jsx         # Auto-dismissing success/error banner
            ├── MerchantForm.jsx  # Create/edit merchant form
            ├── MerchantTable.jsx # Merchant list + edit/delete actions
            ├── PosForm.jsx       # Create/edit POS device form (merchant linking)
            └── PosTable.jsx      # POS device list + edit/delete actions
```

---

## File-by-file explanation

### Root
- **docker-compose.yml** — Defines three services. `db` mounts `init.sql` for first-run schema and persists data to the named volume `pgdata`. `backend` waits for `db` to be healthy before starting. `frontend` waits for `backend`. Every service has a health check; ports are configurable via `.env`.
- **.env.example** — Single source of compose-level configuration (DB credentials, exposed ports, log level). Copy to `.env`.

### Database (`db/`)
- **init.sql** — Enables `pgcrypto` (for `gen_random_uuid()`), creates `merchants` and `pos_devices` tables (UUID PKs, indexes, an `updated_at` trigger), and seeds the two example records from `idea.md`. The Postgres image runs this only when the data volume is empty.

### Backend (`backend/`)
- **src/index.js** — Process entry point. Loads env, waits for the database to accept connections (retries while Postgres boots), starts the HTTP server, and handles `SIGTERM`/`SIGINT` for graceful shutdown.
- **src/app.js** — Builds the Express app: `helmet`, `cors`, JSON body parsing, `morgan` access logs piped to the JSON logger, `/health` (liveness) and `/health/ready` (DB check), then mounts the merchant and POS routers, a 404 handler, and the central error handler.
- **src/config/db.js** — Creates a single `pg` connection pool (from `DATABASE_URL` or discrete `DB_*` vars), exposes a `query()` helper, `waitForDatabase()` for startup, and `closePool()` for shutdown.
- **src/middleware/errorHandler.js** — `ApiError` for expected client errors, a `notFound` handler, and the central error handler that maps Postgres error codes (unique-violation → 409, bad input → 400) and logs 5xx with stack traces.
- **src/middleware/validate.js** — Collects `express-validator` results and returns a `422` with field-level messages, otherwise continues.
- **src/validators/*.js** — Declarative validation chains for create/update on each resource (required fields, lengths, enums, dates, UUIDs).
- **src/controllers/*.js** — The actual CRUD logic. Each whitelists writable columns, builds parameterized SQL (no string interpolation of values), and throws `ApiError` for not-found cases.
- **src/routes/*.js** — Maps HTTP verbs/paths to validation chains + controllers, wrapped in `asyncHandler`.
- **src/utils/logger.js** — Minimal structured JSON logger gated by `LOG_LEVEL`.
- **src/utils/asyncHandler.js** — Wraps async handlers so rejected promises reach the error middleware instead of crashing.
- **Dockerfile** — Installs production deps, copies source, exposes 4000, and defines a container `HEALTHCHECK` hitting `/health`.

### Frontend (`frontend/`)
- **src/main.jsx** — Mounts `<App />`.
- **src/App.jsx** — The whole UI: tabbed switch between Merchants and POS Devices, loads data, debounced search, create/edit/delete flows, and success/error toasts.
- **src/api/client.js** — A configured Axios instance plus typed-ish wrappers (`merchantsApi`, `posDevicesApi`) that normalize backend error shapes into thrown `Error`s.
- **src/components/** — Presentational + form components for each resource, plus the `Toast`.
- **src/styles.css** — Responsive styling (CSS variables, grid forms, badges, mobile breakpoint).
- **vite.config.js** — React plugin and a dev proxy so `/api` reaches the backend during `npm run dev`.
- **nginx.conf** — In production, serves the built SPA and proxies `/api` to the `backend` container.
- **Dockerfile** — Multi-stage: builds the static bundle with Node, then serves it from a small nginx image with its own health check.

---

## DevOps notes
- **Health checks** at the container level (compose) and HTTP level (`/health`, `/health/ready`).
- **Environment variables** drive all configuration; nothing is hard-coded. Secrets live in `.env` (git-ignored).
- **Persistent data** via the `pgdata` named volume — surviving `docker compose down` (use `-v` to wipe).
- **Startup ordering** via `depends_on` + health conditions so the backend never races the database.
- **Graceful shutdown** drains connections on `SIGTERM`.

## Common commands

```bash
docker compose up --build         # build + run
docker compose up -d              # run detached
docker compose logs -f backend    # tail backend logs
docker compose ps                 # service + health status
docker compose down -v            # stop + wipe DB volume
```
