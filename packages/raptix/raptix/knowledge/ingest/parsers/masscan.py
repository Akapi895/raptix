"""Masscan JSON output parser (``masscan -oJ``)."""

from __future__ import annotations

import json
from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix.knowledge.ingest.registry import ParseError
from raptix_core.types.capability import Artifact, Observation


def _entries(content: bytes) -> list[Any]:
    raw = content.decode("utf-8").strip()
    if not raw:
        raise ParseError("masscan output empty")
    try:
        if raw.startswith("["):
            stripped = raw.rstrip()
            suffix = "" if stripped.endswith("]") else "]"
            return json.loads(stripped.rstrip(",\n") + suffix)
        return [json.loads(line.rstrip(",")) for line in raw.splitlines() if line.strip()]
    except (json.JSONDecodeError, ValueError) as exc:
        raise ParseError(f"failed to parse masscan json: {exc}") from exc


class MasscanParser:
    format_id = "masscan"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="ignore").lstrip()
        if head.startswith("[") and '"ip"' in head and '"ports"' in head:
            return 0.85
        for line in head.splitlines():
            line = line.strip().rstrip(",")
            if line.startswith("{") and '"ip"' in line:
                return 0.6
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        observations: list[Observation] = []
        hosts_added = 0
        services_added = 0

        for entry in _entries(content):
            if not isinstance(entry, dict):
                continue
            ip = str(entry.get("ip") or "").strip()
            if not ip:
                continue
            host_key = f"host::{ip}"
            host_edges: list[dict[str, Any]] = []
            for port_row in entry.get("ports") or []:
                if not isinstance(port_row, dict):
                    continue
                try:
                    port = int(port_row.get("port", 0))
                except (TypeError, ValueError):
                    continue
                if not port:
                    continue
                proto = port_row.get("proto", "tcp")
                if port_row.get("status") and port_row.get("status") != "open":
                    continue
                service_key = f"service::{ip}:{port}/{proto}"
                host_edges.append({"to_key": service_key, "kind": "EXPOSES", "weight": 0.6})
                observations.append(
                    node_observation(
                        "Service",
                        key=service_key,
                        label=f"{ip}:{port}/{proto}",
                        props={
                            "host": ip,
                            "port": port,
                            "protocol": proto,
                            "source": "masscan",
                            "service": "unknown",
                            "product": "",
                            "version": "",
                        },
                        edges_out=[{"to_key": host_key, "kind": "HOSTS", "weight": 0.6}],
                    )
                )
                services_added += 1
            observations.append(
                node_observation(
                    "Host",
                    key=host_key,
                    label=ip,
                    props={"ip": ip, "source": "masscan"},
                    edges_out=host_edges,
                )
            )
            hosts_added += 1

        observations.append(
            summary_observation({"hosts_added": hosts_added, "services_added": services_added})
        )
        return observations
