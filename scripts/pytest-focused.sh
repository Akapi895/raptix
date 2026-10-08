#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/.."
uv run pytest "$@" -q 2>&1 | tail -12
