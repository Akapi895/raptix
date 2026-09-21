#!/usr/bin/env bash
# Raptix dev helper. Run from repo root:
#   db | migrate | server | up
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Resolve RAP_CONFIG relative to the repo root, always passing an absolute path
# after the script cd's into backend/. The default file stays optional.
CONFIG_INPUT="${RAP_CONFIG:-configs/app.yaml}"
if [[ "$CONFIG_INPUT" = /* ]]; then
  CONFIG="$CONFIG_INPUT"
else
  CONFIG="$ROOT/$CONFIG_INPUT"
fi
if [[ -n "${RAP_CONFIG+x}" && ! -f "$CONFIG" ]]; then
  echo "RAP_CONFIG does not exist: $CONFIG" >&2
  exit 2
fi

start_db() {
  docker compose -f deploy/compose.yaml up -d --wait postgres
}

case "${1:-}" in
  db)
    start_db
    ;;
  migrate)
    start_db
    (cd backend && go run ./cmd/migrate -config "$CONFIG" -dir migrations -command up)
    ;;
  server)
    (cd backend && go run ./cmd/server -config "$CONFIG")
    ;;
  up)
    start_db
    (cd backend && go run ./cmd/migrate -config "$CONFIG" -dir migrations -command up)
    echo "DB ready. Run 'scripts/dev.sh server' to start the HTTP server."
    ;;
  *)
    echo "usage: $0 {db|migrate|server|up}"
    exit 2
    ;;
esac
