"""Gobuster directory-mode text output parser (``gobuster dir -o``)."""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_GOBUSTER_DIR_RESULT = re.compile(
    r"^(?P<path>/?[A-Za-z0-9._~/%-]+)\s+\(Status: (?P<status>\d{3})\)"
    r"(?:\s+\[Size: (?P<size>\d+)\])?"
)


def _hits(lines: list[str], base_url: str) -> list[tuple[str, int, int]]:
    """Keep only directory-mode hits under the exact supplied web origin."""
    root = urlparse(base_url)
    hits: list[tuple[str, int, int]] = []
    for line in lines:
        match = _GOBUSTER_DIR_RESULT.match(line)
        if match is None:
            continue
        discovered = match.group("path")
        if ".." in discovered.split("/"):
            continue
        url = urljoin(base_url.rstrip("/") + "/", discovered.lstrip("/"))
        parsed = urlparse(url)
        if parsed.netloc.lower() != root.netloc.lower() or parsed.scheme != root.scheme:
            continue
        hits.append((url, int(match.group("status")), int(match.group("size") or 0)))
    return hits


class GobusterParser:
    format_id = "gobuster"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        base_url = str(artifact.metadata.get("base_url") or "")
        if not base_url:
            return 0.0
        head = content[:4096].decode("utf-8", errors="ignore")
        for line in head.splitlines()[:20]:
            if _GOBUSTER_DIR_RESULT.match(line):
                return 0.7
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        base_url = str(artifact.metadata.get("base_url") or "")
        root = urlparse(base_url)
        hits = _hits(content.decode("utf-8").splitlines(), base_url)

        observations: list[Observation] = []
        count = 0
        for url, status, length in hits:
            host_key = f"host::{root.hostname}"
            url_key = f"url::{url}"
            entry_key = f"entrypoint::{url}"
            observations.append(
                node_observation(
                    "Host",
                    key=host_key,
                    label=str(root.hostname),
                    props={"source": "gobuster"},
                    edges_out=[
                        {"to_key": url_key, "kind": "EXPOSES", "weight": 0.5},
                        {"to_key": entry_key, "kind": "EXPOSES", "weight": 0.4},
                    ],
                )
            )
            observations.append(
                node_observation(
                    "URL",
                    key=url_key,
                    label=url,
                    props={"source": "gobuster", "status": status, "length": length},
                )
            )
            observations.append(
                node_observation(
                    "Entrypoint",
                    key=entry_key,
                    label=url,
                    props={
                        "source": "gobuster",
                        "host": root.hostname,
                        "status": status,
                    },
                    edges_out=[{"to_key": url_key, "kind": "EXPOSES", "weight": 0.3}],
                )
            )
            count += 1

        observations.append(summary_observation({"urls_added": count}))
        return observations
