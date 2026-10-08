#!/usr/bin/env bash
set -euo pipefail
EXP=/mnt/d/.VTNet/phase-2/raptix/benchmarks/Silentium/run-20261008-0642
WS=$EXP/workspace
AN=$EXP/analysis
HOSTWS="$HOME/.raptix/workspace/silentium"
mkdir -p "$AN"
# 1. park container-view (post-resume) segments
mv "$WS/record.jsonl" "$AN/record-part2-postresume.jsonl"
mv "$WS/events.jsonl" "$AN/events-part2-postresume.jsonl"
# 2. pull host (pre-resume) segments
cp "$HOSTWS/record.jsonl" "$AN/record-part1-preresume.jsonl"
cp "$HOSTWS/events.jsonl" "$AN/events-part1-preresume.jsonl"
# 3. merge back into workspace as the canonical full trace
cat "$AN/record-part1-preresume.jsonl" "$AN/record-part2-postresume.jsonl" > "$WS/record.jsonl"
cat "$AN/events-part1-preresume.jsonl" "$AN/events-part2-postresume.jsonl" > "$WS/events.jsonl"
# 4. merge workspace artifacts: host-only files added, container files kept
cp -rn "$HOSTWS/." "$WS/"
echo "merged:"
wc -l "$WS/record.jsonl" "$WS/events.jsonl"
ls "$WS"
