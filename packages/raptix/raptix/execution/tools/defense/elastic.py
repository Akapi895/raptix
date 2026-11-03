"""Sigma → Elastic Detection Engine rule (Kibana Detection API push), via pySigma.

Elastic's Detection Engine accepts a JSON rule via
``POST /api/detection_engine/rules``. We translate the Sigma body to a
Lucene query using the official ``pySigma`` engine + the
``pySigma-backend-elasticsearch`` ECS field-mapping pipeline (Detector
mostly emits single-table conditions, so Lucene over EQL).

Earlier versions hand-rolled a partial Sigma condition parser with no
field-name mapping — Sigma's generic field names (``Image``,
``CommandLine``, …) went straight into the Lucene query unmapped, which can
silently miss against a real ECS-indexed Elastic cluster (e.g. ``Image``
needs to be ``process.executable.caseless``). pySigma's ECS pipeline fixes
that at the source.
"""

from __future__ import annotations

import json
from typing import Any

from raptix_defense.conops import (
    ConOpsLookupError,
    engagement_slug,
    resolve_auth_value,
    resolve_siem_target,
)
from sigma.backends.elasticsearch import LuceneBackend
from sigma.collection import SigmaCollection
from sigma.exceptions import SigmaError
from sigma.pipelines.elasticsearch import ecs_windows


class SigmaToElasticError(RuntimeError):
    """Raised when pySigma can't translate a Sigma rule to a Lucene query."""


def sigma_to_lucene(sigma_rule: dict[str, Any]) -> str:
    """Translate a Sigma rule dict to a Lucene query string via pySigma.

    Applies the ECS Windows field-mapping pipeline when the rule's
    ``logsource.product`` is ``windows``; other log sources convert without
    a pipeline. Raises SigmaToElasticError — not a raw pySigma exception —
    so callers keep one exception type to catch.
    """
    logsource = sigma_rule.get("logsource") or {}
    pipeline = ecs_windows() if logsource.get("product") == "windows" else None
    try:
        collection = SigmaCollection.from_dicts([sigma_rule])
        queries = LuceneBackend(processing_pipeline=pipeline).convert(collection)
    except SigmaError as exc:
        raise SigmaToElasticError(str(exc)) from exc
    if not queries:
        raise SigmaToElasticError("pySigma produced no Lucene query for this rule")
    return str(queries[0])


_SEVERITY_MAP = {
    "informational": "low",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "critical": "critical",
}


def push_detection_rule(
    rule_id: str,
    name: str,
    lucene_query: str,
    *,
    description: str = "",
    severity: str = "medium",
    technique_id: str = "",
    index_patterns: list[str] | None = None,
) -> dict[str, Any]:
    """POST a custom detection rule to Elastic via Kibana Detection Engine API."""
    try:
        target = resolve_siem_target("elastic")
    except ConOpsLookupError as exc:
        return {"error": str(exc)}

    url = target.get("url")
    auth_spec = target.get("auth")
    if not url or not auth_spec:
        return {"error": "ConOps.blue_team.elastic missing ``url`` or ``auth``"}
    try:
        api_key = resolve_auth_value(auth_spec)
    except ConOpsLookupError as exc:
        return {"error": str(exc)}

    tagged_id = f"raptix-eng-{engagement_slug()}-{rule_id}"
    body = {
        "rule_id": tagged_id,
        "name": f"[Raptix] {name}",
        "description": (
            description
            + f"\n\nEngagement: {engagement_slug()}"
            + (f"\nMITRE ATT&CK: {technique_id}" if technique_id else "")
        ),
        "severity": _SEVERITY_MAP.get(severity.lower(), "medium"),
        "risk_score": 50,
        "type": "query",
        "language": "lucene",
        "query": lucene_query,
        "index": index_patterns or ["logs-*", "filebeat-*", "winlogbeat-*"],
        "from": "now-5m",
        "interval": "5m",
        "enabled": True,
        "tags": ["decepticon", f"engagement:{engagement_slug()}"]
        + ([technique_id] if technique_id else []),
    }

    try:
        import requests  # noqa: PLC0415
    except ImportError:
        return {"error": "``requests`` not installed in langgraph container"}

    headers = {
        "Authorization": f"ApiKey {api_key}",
        "Content-Type": "application/json",
        "kbn-xsrf": "true",
    }
    endpoint = url.rstrip("/") + "/api/detection_engine/rules"
    try:
        resp = requests.post(endpoint, headers=headers, data=json.dumps(body), timeout=15)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Elastic POST failed: {exc!r}"}

    if resp.status_code == 409:
        endpoint_put = endpoint + f"?rule_id={tagged_id}"
        try:
            resp = requests.put(endpoint_put, headers=headers, data=json.dumps(body), timeout=15)
        except Exception as exc:  # noqa: BLE001
            return {"error": f"Elastic PUT (replace) failed: {exc!r}"}

    if resp.status_code >= 400:
        return {
            "error": f"Elastic returned HTTP {resp.status_code}",
            "body": resp.text[:1000],
        }
    return {
        "status": "pushed",
        "rule_id": tagged_id,
        "engagement_slug": engagement_slug(),
        "technique_id": technique_id,
        "severity": severity,
    }
