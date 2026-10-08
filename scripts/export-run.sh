#!/usr/bin/env bash
set -euo pipefail
SRC="$HOME/.raptix/workspace/silentium"
TS=$(date +%Y%m%d-%H%M)
OUT="/mnt/d/.VTNet/phase-2/raptix/benchmarks/Silentium/run-$TS"
mkdir -p "$OUT/logs"
cp -a "$SRC/." "$OUT/workspace/"
cd /mnt/d/.VTNet/phase-2/raptix
docker compose logs langgraph > "$OUT/logs/langgraph.log" 2>&1 || true
docker compose logs litellm  > "$OUT/logs/litellm.log" 2>&1 || true
echo "EXPORTED -> $OUT"
du -sh "$OUT"
find "$OUT/workspace" -maxdepth 2 -type d | sort
