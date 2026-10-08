"""Katana JSONL crawl output parser (``katana -jsonl -o``)."""

from __future__ import annotations

import json
from urllib.parse import urlparse

from raptix.knowledge.ingest.parsers._shared import (
    node_observation,
    sniff_first_json_line,
    summary_observation,
)
from raptix_core.types.capability import Artifact, Observation


class KatanaJsonlParser:
    format_id = "katana_jsonl"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        record = sniff_first_json_line(content)
        if record is None:
            return 0.0
        if "endpoint" in record or "request" in record or ("url" in record and "method" in record):
            return 0.7
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        observations: list[Observation] = []
        urls_added = 0

        for raw in content.decode("utf-8").splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            request = row.get("request") if isinstance(row.get("request"), dict) else {}
            endpoint = row.get("endpoint") or request.get("endpoint") or row.get("url") or ""
            if not endpoint:
                continue
            parsed_url = urlparse(endpoint)
            host_value = (parsed_url.hostname or "").lower()
            if not host_value:
                continue
            method = row.get("method") or request.get("method") or "GET"

            host_key = f"host::{host_value}"
            url_key = f"url::{endpoint}"
            entrypoint_key = f"entrypoint::{endpoint}"
            observations.append(
                node_observation(
                    "Host",
                    key=host_key,
                    label=host_value,
                    props={"source": "katana"},
                    edges_out=[
                        {"to_key": url_key, "kind": "EXPOSES", "weight": 0.5},
                        {"to_key": entrypoint_key, "kind": "EXPOSES", "weight": 0.4},
                    ],
                )
            )
            observations.append(
                node_observation(
                    "URL",
                    key=url_key,
                    label=endpoint,
                    props={"source": "katana", "method": method},
                    edges_out=[
                        {"to_key": host_key, "kind": "HOSTS", "weight": 0.5},
                        {"to_key": entrypoint_key, "kind": "HOSTS", "weight": 0.3},
                    ],
                )
            )
            observations.append(
                node_observation(
                    "Entrypoint",
                    key=entrypoint_key,
                    label=endpoint,
                    props={"source": "katana", "host": host_value},
                    edges_out=[
                        {"to_key": host_key, "kind": "HOSTS", "weight": 0.4},
                        {"to_key": url_key, "kind": "EXPOSES", "weight": 0.3},
                    ],
                )
            )
            urls_added += 1

        observations.append(summary_observation({"urls_added": urls_added}))
        return observations
