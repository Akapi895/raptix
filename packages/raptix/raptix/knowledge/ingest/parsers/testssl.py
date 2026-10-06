"""testssl.sh JSON output parser (``testssl.sh --jsonfile``/``-oJ``)."""

from __future__ import annotations

import json
from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix.knowledge.ingest.registry import ParseError
from raptix_core.types.capability import Artifact, Observation
from raptix_core.types.kg import Severity

_SEVERITY_MAP = {
    "CRITICAL": Severity.CRITICAL,
    "HIGH": Severity.HIGH,
    "MEDIUM": Severity.MEDIUM,
    "LOW": Severity.LOW,
    "WARN": Severity.LOW,
    "INFO": Severity.INFO,
    "OK": Severity.INFO,
}


def _rows_and_envelope_target(data: Any) -> tuple[list[dict[str, Any]], str]:
    rows: list[dict[str, Any]] = []
    envelope_target = ""
    if isinstance(data, list):
        rows = [r for r in data if isinstance(r, dict)]
    elif isinstance(data, dict):
        envelope_target = str(data.get("targetHost") or data.get("target") or "").strip()
        # Newer testssl wraps everything in {"scanResult": [...]}
        scan_result = data.get("scanResult")
        if isinstance(scan_result, list):
            for entry in scan_result:
                if not isinstance(entry, dict):
                    continue
                if not envelope_target:
                    envelope_target = str(
                        entry.get("targetHost") or entry.get("target") or ""
                    ).strip()
                section = entry.get("vulnerabilities") or entry.get("serverDefaults") or []
                if isinstance(section, list):
                    rows.extend(r for r in section if isinstance(r, dict))
    return rows, envelope_target


class TestsslParser:
    format_id = "testssl"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        head = content[:4096].decode("utf-8", errors="ignore").lstrip()
        if not head.startswith(("[", "{")):
            return 0.0
        if '"scanResult"' in head:
            return 0.85
        if '"severity"' in head and '"finding"' in head:
            return 0.8
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        explicit_target = str(artifact.metadata.get("target") or "").strip()
        try:
            data = json.loads(content.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ParseError(f"failed to parse testssl json: {exc}") from exc

        rows, envelope_target = _rows_and_envelope_target(data)
        host_label = (explicit_target or envelope_target).strip()

        observations: list[Observation] = []
        vulns_added = 0
        linked = 0
        host_edges: list[dict[str, object]] = []
        scope = host_label or "unscoped"
        host_key = f"host::{host_label.split(':', 1)[0].lower()}" if host_label else None
        for row in rows:
            sev_raw = str(row.get("severity") or "INFO").upper()
            severity = _SEVERITY_MAP.get(sev_raw, Severity.INFO)
            if severity in {Severity.INFO, Severity.LOW}:
                continue
            rule_id = str(row.get("id") or "testssl.finding")
            finding = str(row.get("finding") or "").strip()
            key = f"testssl::{scope}::{rule_id}::{finding[:48]}"
            observations.append(
                node_observation(
                    "Vulnerability",
                    key=key,
                    label=f"[testssl:{rule_id}] {finding[:80]}",
                    props={
                        "scanner": "testssl",
                        "rule_id": rule_id,
                        "severity": severity.value,
                        "description": finding,
                        "target": host_label,
                    },
                )
            )
            vulns_added += 1
            if host_key is not None:
                # HAS_VULN points host → vuln, so the edge hangs off the Host
                # observation (each edge is emitted from its source node).
                host_edges.append({"to_key": key, "kind": "HAS_VULN", "weight": 0.6})
                linked += 1

        if host_key is not None:
            # Strip port suffix for the graph host key
            observations.insert(
                0,
                node_observation(
                    "Host",
                    key=host_key,
                    label=host_key.removeprefix("host::"),
                    props={"source": "testssl"},
                    edges_out=host_edges,
                ),
            )

        observations.append(
            summary_observation(
                {"vulns_added": vulns_added, "linked_to_host": linked, "host": host_label}
            )
        )
        return observations
