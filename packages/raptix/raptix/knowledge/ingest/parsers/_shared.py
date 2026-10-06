"""Helpers shared by the built-in artifact parsers."""

from __future__ import annotations

import json
from typing import Any

from raptix.knowledge.ingest.registry import SUMMARY_KIND
from raptix_core.types.capability import Observation
from raptix_core.types.kg import Severity

_SNIFF_BYTES = 4096


def severity_from_string(value: str | None) -> Severity:
    """Map a scanner severity label onto :class:`Severity` (unknown → MEDIUM)."""
    if not value:
        return Severity.MEDIUM
    normalized = value.strip().lower()
    mapping = {
        "critical": Severity.CRITICAL,
        "high": Severity.HIGH,
        "medium": Severity.MEDIUM,
        "low": Severity.LOW,
        "info": Severity.INFO,
        "informational": Severity.INFO,
    }
    return mapping.get(normalized, Severity.MEDIUM)


def sniff_text(content: bytes) -> str:
    """Bounded, lossy text view of ``content`` for format sniffing."""
    return content[:_SNIFF_BYTES].decode("utf-8", errors="ignore")


def sniff_first_json_line(content: bytes) -> dict[str, Any] | None:
    """First non-empty JSONL record in ``content``, if one parses."""
    for line in sniff_text(content).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            return None
        return record if isinstance(record, dict) else None
    return None


def node_observation(
    kind: str,
    *,
    key: str,
    label: str,
    props: dict[str, Any] | None = None,
    edges_out: list[dict[str, Any]] | None = None,
) -> Observation:
    """Build a graph-write :class:`Observation` (NodeKind-valued kind)."""
    data: dict[str, Any] = {"key": key, "label": label, "props": props or {}}
    if edges_out:
        data["edges_out"] = edges_out
    return Observation(kind=kind, data=data)


def summary_observation(data: dict[str, Any]) -> Observation:
    """Build the ``parse.summary`` observation carrying per-format counters."""
    return Observation(kind=SUMMARY_KIND, data=data)
