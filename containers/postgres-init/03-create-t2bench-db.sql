-- Create the t2bench database used by the T2 Juice Shop benchmark harness as a
-- durable, license-free checkpoint store (runner-managed; see
-- benchmark/juice_shop_t2.py). It holds one latest thread-state snapshot per run
-- so a run survives a LangGraph restart / laptop shutdown and can be resumed.
--
-- Postgres auto-runs files in /docker-entrypoint-initdb.d/ on first startup only
-- (empty data volume). For an existing deployment the runner bootstraps the DB
-- and table idempotently at run start, so this file is just the fresh-install path.
--
-- Manual apply to an existing volume (what the runner also does):
--   docker exec raptix-postgres psql -U raptix -c "CREATE DATABASE t2bench;"

CREATE DATABASE t2bench;
GRANT ALL PRIVILEGES ON DATABASE t2bench TO raptix;
