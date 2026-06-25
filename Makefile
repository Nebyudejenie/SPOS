# SPOS — one-command pipeline.
# Detects docker compose v2 ("docker compose") or legacy ("docker-compose").
COMPOSE := $(shell if docker compose version >/dev/null 2>&1; then echo "docker compose"; \
                   else echo "docker-compose"; fi)
PY      := .venv/bin/python
PIP     := .venv/bin/pip

# DB connection for the ETL (host -> compose Postgres). Override on the CLI if needed.
export PGHOST     ?= localhost
export PGPORT     ?= 5432
export PGUSER     ?= postgres
export PGPASSWORD ?= postgres
export PGDATABASE ?= appdb

.PHONY: help up down logs ps venv etl bronze silver dedup pipeline psql test clean reset

help:
	@echo "SPOS targets:"
	@echo "  make up        - build & start db + backend + frontend (detached)"
	@echo "  make pipeline  - up + wait for db + run full ETL (bronze + silver)"
	@echo "  make etl       - run bronze + silver + dedup against the running db"
	@echo "  make test      - run the ETL unit tests (no DB needed)"
	@echo "  make psql      - open psql in the db container"
	@echo "  make logs / ps - tail logs / show service status"
	@echo "  make down      - stop services (keep data)"
	@echo "  make reset     - stop services and wipe the Postgres volume"
	@echo "  Frontend: http://localhost:8080   Backend: http://localhost:4000/health"

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

venv:
	@test -d .venv || python3 -m venv .venv
	@$(PIP) install -q -r etl/requirements.txt
	@echo "venv ready"

# Wait until the db container reports healthy, then load.
pipeline: up venv
	@echo "Waiting for Postgres to become healthy…"
	@until [ "`docker inspect -f '{{.State.Health.Status}}' spos-db 2>/dev/null`" = "healthy" ]; \
		do sleep 2; done
	@$(MAKE) etl

etl: bronze silver dedup

bronze: venv
	$(PY) etl/load_bronze.py

silver: venv
	$(PY) etl/build_silver.py

dedup: venv
	$(PY) etl/dedup_merchants.py --apply

test: venv
	$(PY) -m unittest discover -s etl/tests -t etl/tests -p 'test_*.py'

psql:
	docker exec -it spos-db psql -U $(PGUSER) -d $(PGDATABASE)

clean:
	rm -rf .venv scratch_*.py scratch_*.json
