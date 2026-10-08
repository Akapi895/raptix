-- Create the web dashboard database alongside the existing litellm database.
-- This script runs on first postgres startup via docker-entrypoint-initdb.d.
SELECT 'CREATE DATABASE raptix_web OWNER raptix'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'raptix_web')\gexec
