#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/.."
set -a; source .env; set +a
echo "== smoke: create_llm('recon') via .env creds =="
exec uv run python -c "from raptix.intelligence.llm.factory import create_llm; print(create_llm('recon').invoke('say OK').content)"
