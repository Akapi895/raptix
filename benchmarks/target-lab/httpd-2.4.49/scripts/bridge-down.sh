#!/bin/sh
# Stop and remove the sliver-bridge container and its state volume.
# Phase 2 lab is disposable by design: ownership/listener state does not
# survive this, and the web engagement's listener rows go stale with it.
set -eu
LAB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ENV="$LAB_DIR/../../../.env"
COMPOSE_ENV_ARGS=""
if [ -f "$REPO_ENV" ] && grep -q '^RAPTIX_STACK_SANDBOX_NETWORK=' "$REPO_ENV"; then
    COMPOSE_ENV_ARGS="--env-file $REPO_ENV"
fi
cd "$LAB_DIR"
# shellcheck disable=SC2086
docker compose -f bridge-compose.yml $COMPOSE_ENV_ARGS down -v
