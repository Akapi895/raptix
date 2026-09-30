-- Create the raptix_web database used by the Web dashboard.
--
-- Postgres auto-runs files in /docker-entrypoint-initdb.d/ on first startup
-- (only when data volume is empty). This ensures raptix_web exists
-- alongside the litellm database created by POSTGRES_DB.
--
-- To apply to an existing deployment without data loss, create the DB
-- manually: `docker exec raptix-postgres psql -U raptix -c "CREATE DATABASE raptix_web;"`

CREATE DATABASE raptix_web;
GRANT ALL PRIVILEGES ON DATABASE raptix_web TO raptix;
