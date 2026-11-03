#!/bin/sh
# Stop and remove the target lab container.
# Mirrors scripts/up.sh's env-file resolution so `down` targets the same
# compose project regardless of RAPTIX_STACK_SANDBOX_NETWORK.
set -eu
LAB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ENV="$LAB_DIR/../../../.env"
COMPOSE_ENV_ARGS=""
if [ -f "$REPO_ENV" ] && grep -q '^RAPTIX_STACK_SANDBOX_NETWORK=' "$REPO_ENV"; then
    COMPOSE_ENV_ARGS="--env-file $REPO_ENV"
fi
cd "$LAB_DIR"
# shellcheck disable=SC2086
docker compose $COMPOSE_ENV_ARGS down
