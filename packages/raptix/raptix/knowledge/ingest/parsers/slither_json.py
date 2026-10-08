"""Slither JSON-report parser (``contracts.audit_static`` output).

Slither's ``--json`` report is one object; findings live in
``results.detectors`` entries of the shape::

    {
      "check": "arbitrary-send",
      "impact": "High",
      "confidence": "Medium",
      "description": "...",
      "elements": [{"type": "function", "name": "withdraw", ...}]
    }

Each detector entry becomes one Vulnerability observation keyed by
check id, with impact/confidence/evidence props carried verbatim —
the parser never re-scores slither's findings. Failure shapes (compile
errors) are recorded in the summary, never as fabricated findings.
"""

from __future__ import annotations

import json
from typing import Any

from raptix.knowledge.ingest.parsers._shared import node_observation, summary_observation
from raptix_core.types.capability import Artifact, Observation

_MAX_FINDINGS = 100
_MAX_DESC = 400


class SlitherJsonParser:
    format_id = "slither_json"
    parser_version = "1.0.0"

    def supports(self, artifact: Artifact, content: bytes) -> float:
        try:
            data = json.loads(content[:65536].decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return 0.0
        if not isinstance(data, dict):
            return 0.0
        results = data.get("results")
        if isinstance(results, dict) and isinstance(results.get("detectors"), list):
            return 0.9
        if "error" in data or "success" in data:
            return 0.5
        return 0.0

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        data = json.loads(content.decode("utf-8", errors="replace"))
        results = data.get("results") or {}
        detectors = results.get("detectors") or []

        observations: list[Observation] = []
        seen_checks: dict[str, int] = {}
        for index, finding in enumerate(detectors[:_MAX_FINDINGS]):
            check = str(finding.get("check") or "unknown_check")
            seen_checks[check] = seen_checks.get(check, 0) + 1
            elements = finding.get("elements") or []
            functions = [
                str(el.get("name"))
                for el in elements
                if isinstance(el, dict) and el.get("type") == "function" and el.get("name")
            ]
            source_info = [
                el.get("source_mapping", {}).get("filename_relative", "")
                for el in elements
                if isinstance(el, dict) and isinstance(el.get("source_mapping"), dict)
            ]
            props: dict[str, Any] = {
                "source": "slither",
                "check": check,
                "impact": str(finding.get("impact") or "Unknown"),
                "confidence": str(finding.get("confidence") or "Unknown"),
                "evidence": "tool_reported",
                "description": str(finding.get("description") or "")[:_MAX_DESC],
            }
            if functions:
                props["functions"] = functions[:10]
            if any(source_info):
                props["files"] = sorted({s for s in source_info if s})[:10]
            observations.append(
                node_observation(
                    "Vulnerability",
                    key=f"vuln-slither::{check}::{index}",
                    label=check,
                    props=props,
                )
            )

        error = data.get("error")
        observations.append(
            summary_observation(
                {
                    "findings": len(detectors),
                    "checks": sorted(seen_checks),
                    "compile_error": str(error)[:_MAX_DESC] if error else None,
                }
            )
        )
        return observations
