"""ffuf JSON output parser (``ffuf -o``)."""

from __future__ import annotations

import json
from urllib.parse import urlparse

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix.knowledge.ingest.registry import ParseError
from raptix_core.types.capability import Artifact, Observation


class FfufParser:
    format_id = "ffuf"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="ignore").lstrip()
        if not head.startswith("{"):
            return 0.0
        try:
            data = json.loads(content.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return 0.0
        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return 0.85
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        try:
            data = json.loads(content.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ParseError(f"failed to parse ffuf json: {exc}") from exc

        observations: list[Observation] = []
        urls_added = 0
        entrypoints_added = 0

        for row in data.get("results") or []:
            url = row.get("url") or ""
            if not url:
                continue
            try:
                status = int(row.get("status") or 0)
            except (ValueError, TypeError):
                status = 0
            try:
                length = int(row.get("length") or 0)
            except (ValueError, TypeError):
                length = 0
            parsed_url = urlparse(url)
            host_value = (parsed_url.hostname or "").lower()

            host_key = f"host::{host_value}" if host_value else None
            url_key = f"url::{url}"
            entrypoint_key = f"entrypoint::{url}"
            host_edges: list[dict[str, object]] = []
            if host_key is not None:
                host_edges.extend(
                    [
                        {"to_key": url_key, "kind": "EXPOSES", "weight": 0.5},
                        {"to_key": entrypoint_key, "kind": "EXPOSES", "weight": 0.4},
                    ]
                )
                observations.append(
                    node_observation(
                        "Host",
                        key=host_key,
                        label=host_value,
                        props={"source": "ffuf"},
                        edges_out=host_edges,
                    )
                )
            observations.append(
                node_observation(
                    "URL",
                    key=url_key,
                    label=url,
                    props={"source": "ffuf", "status": status, "length": length},
                    edges_out=(
                        [{"to_key": host_key, "kind": "HOSTS", "weight": 0.5}]
                        if host_key is not None
                        else []
                    ),
                )
            )
            observations.append(
                node_observation(
                    "Entrypoint",
                    key=entrypoint_key,
                    label=url,
                    props={
                        "source": "ffuf",
                        "host": host_value,
                        "status": status,
                    },
                    edges_out=(
                        [
                            {"to_key": host_key, "kind": "HOSTS", "weight": 0.4},
                            {"to_key": url_key, "kind": "EXPOSES", "weight": 0.3},
                        ]
                        if host_key is not None
                        else [{"to_key": url_key, "kind": "EXPOSES", "weight": 0.3}]
                    ),
                )
            )
            urls_added += 1
            entrypoints_added += 1

        observations.append(
            summary_observation({"urls_added": urls_added, "entrypoints_added": entrypoints_added})
        )
        return observations
