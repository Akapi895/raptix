#!/usr/bin/env bash
# Bootstrap the apps/api (ui-app BFF, ADR-0106) Postgres database.
#
# apps/api owns its own database on the same shared Postgres server --
# not a new container, just a separate schema/migration lifecycle from
# the `litellm` database (LiteLLM spend logs) and BHCE's `bloodhound`
# database. Reuses the existing `raptix` superuser-ish role as owner;
# apps/api's own Prisma migrations manage everything inside the database
# from there.
#
# Postgres auto-runs files in /docker-entrypoint-initdb.d/ on first boot
# only. Existing deployments already have a populated postgres_data
# volume, so this script is also idempotent and re-run by the
# `raptix-api-postgres-init` sidecar on every `docker compose up` --
# same pattern as 02-bloodhound-db.sh.
set -euo pipefail

API_DB_NAME="${RAPTIX_API_POSTGRES_DB:-raptix_api}"

psql -v ON_ERROR_STOP=1 \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    -v api_db_name="${API_DB_NAME}" \
    -v api_db_owner="${POSTGRES_USER}" <<-'EOSQL'
    SELECT format('CREATE DATABASE %I OWNER %I', :'api_db_name', :'api_db_owner')
    WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'api_db_name')
    \gexec

    SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'api_db_name', :'api_db_owner')
    \gexec
EOSQL
