"""Ingest a generated asset-map dataset through the runtime's real writers.

Each nmap-*.xml goes through the nmap writer and each katana-*.jsonl through the katana writer, as a
real scan would. Prints per-file timings, so a regression shows as a number.

    docker cp scripts/asset-map/data raptix-web-raptix-web-runtime-1:/tmp/asset-map-data
    docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml       exec -T web-runtime python -I - <engagement> /tmp/asset-map-data < scripts/asset-map/ingest_dataset.py
"""

import glob
import os
import sys
import time
from pathlib import Path

from raptix.knowledge.graph.ingest import ingest
from raptix.knowledge.graph.store import KGStore

engagement, data_dir = sys.argv[1], sys.argv[2]
store = KGStore.from_env()
started = time.time()
try:
    for kind, pattern in (("nmap_xml", "nmap-*.xml"), ("katana_jsonl", "katana-*.jsonl")):
        for path in sorted(glob.glob(os.path.join(data_dir, pattern))):
            began = time.time()
            result = ingest(kind, Path(path), store=store, engagement=engagement, created_by="asset-map-bench", source_episode_id="bench-" + Path(path).name)
            print(kind, Path(path).name, round(time.time() - began, 2), "s", result.get("records", result), flush=True)
finally:
    store.close()
print("total_seconds", round(time.time() - started, 1), flush=True)
