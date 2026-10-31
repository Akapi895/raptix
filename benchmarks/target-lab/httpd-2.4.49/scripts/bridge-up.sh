#!/bin/sh
# Build and start the IW-09 sliver-bridge next to the target lab (Phase 2).
# Requires SLIVER_BRIDGE_TOKEN in the local .env (see .env.example).
set -eu
LAB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ENV="$LAB_DIR/../../../.env"
COMPOSE_ENV_ARGS=""
if [ -f "$REPO_ENV" ] && grep -q '^RAPTIX_STACK_SANDBOX_NETWORK=' "$REPO_ENV"; then
    COMPOSE_ENV_ARGS="--env-file $REPO_ENV"
fi
cd "$LAB_DIR"
# shellcheck disable=SC2086
docker compose -f bridge-compose.yml $COMPOSE_ENV_ARGS up -d --build
# shellcheck disable=SC2086
docker compose -f bridge-compose.yml $COMPOSE_ENV_ARGS ps
