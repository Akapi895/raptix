#!/bin/sh
# Build and start the vulnerable target on the Raptix sandbox network.
# Paths resolve relative to this script, so it can run from anywhere.
#
# The sandbox network name must match the running Raptix stack. If the repo
# root .env declares RAPTIX_STACK_SANDBOX_NETWORK it is used automatically;
# otherwise compose falls back to `raptix_sandbox-net` (see docker-compose.yml).
set -eu
LAB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ENV="$LAB_DIR/../../../.env"
COMPOSE_ENV_ARGS=""
if [ -f "$REPO_ENV" ] && grep -q '^RAPTIX_STACK_SANDBOX_NETWORK=' "$REPO_ENV"; then
    COMPOSE_ENV_ARGS="--env-file $REPO_ENV"
fi
cd "$LAB_DIR"
# shellcheck disable=SC2086
docker compose $COMPOSE_ENV_ARGS up -d --build
# shellcheck disable=SC2086
docker compose $COMPOSE_ENV_ARGS ps
