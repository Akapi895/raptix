"""httpx JSONL output parser (``httpx -json -o``)."""

from __future__ import annotations

import json
from urllib.parse import urlparse

from raptix.knowledge.ingest.parsers._shared import (
    node_observation,
    sniff_first_json_line,
    summary_observation,
)
from raptix_core.types.capability import Artifact, Observation
from raptix_core.types.kg import Severity


class HttpxJsonlParser:
    format_id = "httpx_jsonl"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        record = sniff_first_json_line(content)
        if record is None:
            return 0.0
        if "status-code" in record and ("url" in record or "input" in record):
            return 0.75
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        scanner_hint = str(artifact.metadata.get("scanner_hint") or "httpx")
        observations: list[Observation] = []
        parsed = 0
        skipped = 0
        entrypoints = 0
        service_links = 0

        for raw_line in content.decode("utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue

            url = str(row.get("url") or row.get("input") or "").strip()
            if not url:
                skipped += 1
                continue
            parsed += 1

            parsed_url = urlparse(url)
            host_value = (
                str(row.get("host") or parsed_url.hostname or row.get("input") or "")
                .strip()
                .lower()
            )
            if not host_value:
                skipped += 1
                continue

            port = row.get("port") or parsed_url.port
            try:
                port_int = (
                    int(port) if port is not None else (443 if parsed_url.scheme == "https" else 80)
                )
            except (TypeError, ValueError):
                port_int = 443 if parsed_url.scheme == "https" else 80

            scheme = parsed_url.scheme or ("https" if port_int in {443, 8443} else "http")
            status_code = row.get("status-code")
            title = row.get("title")
            webserver = row.get("webserver")
            technologies = row.get("tech") if isinstance(row.get("tech"), list) else []

            host_key = f"host::{host_value}"
            service_key = f"service::{host_value}:{port_int}/tcp"
            entrypoint_key = f"entrypoint::{url}"
            url_node_key = f"url::{url}"

            vulnerability_key: str | None = None
            if isinstance(status_code, int) and status_code >= 500:
                vulnerability_key = f"{scanner_hint}::http-5xx::{url}"

            entrypoint_edges: list[dict[str, object]] = [
                {"to_key": host_key, "kind": "HOSTS", "weight": 0.5},
                {"to_key": service_key, "kind": "HOSTS", "weight": 0.4},
                {"to_key": url_node_key, "kind": "EXPOSES", "weight": 0.3},
            ]
            if vulnerability_key is not None:
                entrypoint_edges.append(
                    {"to_key": vulnerability_key, "kind": "HAS_VULN", "weight": 0.7}
                )

            observations.append(
                node_observation(
                    "Host",
                    key=host_key,
                    label=host_value,
                    props={"source": scanner_hint},
                    edges_out=[{"to_key": entrypoint_key, "kind": "EXPOSES", "weight": 0.5}],
                )
            )
            observations.append(
                node_observation(
                    "Service",
                    key=service_key,
                    label=f"{host_value}:{port_int}/tcp",
                    props={
                        "host": host_value,
                        "port": port_int,
                        "protocol": "tcp",
                        "source": scanner_hint,
                        "service": "http",
                        "scheme": scheme,
                        "status_code": status_code,
                        "webserver": webserver,
                        "technologies": technologies,
                    },
                    edges_out=[{"to_key": entrypoint_key, "kind": "EXPOSES", "weight": 0.4}],
                )
            )
            observations.append(
                node_observation(
                    "Entrypoint",
                    key=entrypoint_key,
                    label=url,
                    props={
                        "source": scanner_hint,
                        "host": host_value,
                        "scheme": scheme,
                        "port": port_int,
                        "status_code": status_code,
                        "title": title,
                        "webserver": webserver,
                        "technologies": technologies,
                    },
                    edges_out=entrypoint_edges,
                )
            )
            observations.append(
                node_observation(
                    "URL",
                    key=url_node_key,
                    label=url,
                    props={
                        "source": scanner_hint,
                        "status_code": status_code,
                        "title": title,
                        "webserver": webserver,
                        "technologies": technologies,
                    },
                    edges_out=[{"to_key": entrypoint_key, "kind": "HOSTS", "weight": 0.3}],
                )
            )
            if vulnerability_key is not None:
                observations.append(
                    node_observation(
                        "Vulnerability",
                        key=vulnerability_key,
                        label=f"[{scanner_hint}] unstable endpoint {url}",
                        props={
                            "scanner": scanner_hint,
                            "rule_id": "http-5xx",
                            "severity": Severity.LOW.value,
                            "status_code": status_code,
                        },
                    )
                )
            entrypoints += 1
            service_links += 1

        observations.append(
            summary_observation(
                {
                    "parsed": parsed,
                    "skipped": skipped,
                    "entrypoints": entrypoints,
                    "service_links": service_links,
                }
            )
        )
        return observations
