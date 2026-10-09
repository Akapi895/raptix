"""Sigma → Splunk Saved Search converter (via pySigma) + HEC publisher.

The Splunk path is the simplest of the SIEM exporters: we translate a Sigma
rule body to an SPL search using the official ``pySigma`` engine + the
``pySigma-backend-splunk`` CIM field-mapping pipeline, then POST it via the
Saved Searches REST API (``/services/saved/searches``).

Earlier versions of this module hand-rolled a partial Sigma condition
parser with no field-name mapping. That both under-supports the Sigma
condition DSL (no ``1 of``/``all of``/aggregations) and — more importantly —
passes Sigma's generic field names straight into SPL unmapped, which can
silently produce a syntactically valid but semantically wrong query against
a real Splunk index. pySigma's processing-pipeline mechanism exists
specifically to solve the field-mapping half of that problem.
"""

from __future__ import annotations

from typing import Any

from raptix_defense.conops import (
    ConOpsLookupError,
    engagement_slug,
    resolve_auth_value,
    resolve_siem_target,
)
from sigma.backends.splunk import SplunkBackend
from sigma.collection import SigmaCollection
from sigma.exceptions import SigmaError
from sigma.pipelines.splunk import splunk_windows_pipeline


class SigmaConversionError(RuntimeError):
    """Raised when pySigma can't translate a Sigma rule to SPL."""


def sigma_to_spl(sigma_rule: dict[str, Any]) -> str:
    """Translate a Sigma rule dict to a Splunk SPL search string via pySigma.

    Applies the Windows CIM field-mapping pipeline when the rule's
    ``logsource.product`` is ``windows``; other log sources convert without a
    pipeline (same field-name-passthrough limitation pySigma's raw backend
    has for sources with no bundled pipeline). Raises SigmaConversionError —
    not a raw pySigma exception — so callers keep one exception type to catch.
    """
    logsource = sigma_rule.get("logsource") or {}
    pipeline = splunk_windows_pipeline() if logsource.get("product") == "windows" else None
    try:
        collection = SigmaCollection.from_dicts([sigma_rule])
        queries = SplunkBackend(processing_pipeline=pipeline).convert(collection)
    except SigmaError as exc:
        raise SigmaConversionError(str(exc)) from exc
    if not queries:
        raise SigmaConversionError("pySigma produced no SPL query for this rule")
    return str(queries[0])


def push_savedsearch(
    title: str,
    spl_query: str,
    *,
    description: str = "",
    technique_id: str = "",
    severity: str = "medium",
) -> dict[str, Any]:
    """POST the saved-search to Splunk via REST.

    Reads the Splunk endpoint + HEC token from ConOps (``blue_team.splunk``).
    Tags the saved search ``raptix-eng-<slug>`` so blue-team can audit
    and disable rules after the engagement ends.

    Returns the parsed Splunk response on success or a ``{"error": ...}``
    dict if the push failed — agents see this directly.
    """
    try:
        target = resolve_siem_target("splunk")
    except ConOpsLookupError as exc:
        return {"error": str(exc)}

    url = target.get("url")
    auth_spec = target.get("auth")
    if not url or not auth_spec:
        return {"error": "ConOps.blue_team.splunk missing ``url`` or ``auth``"}
    try:
        token = resolve_auth_value(auth_spec)
    except ConOpsLookupError as exc:
        return {"error": str(exc)}

    tag = f"raptix-eng-{engagement_slug()}"
    safe_title = f"{tag}::{title}"

    try:
        import requests  # noqa: PLC0415
    except ImportError:
        return {"error": "``requests`` not installed in langgraph container"}

    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "name": safe_title,
        "search": spl_query,
        "description": (
            f"{description}\n\n"
            f"Created by Raptix engagement ``{engagement_slug()}``"
            + (f"\nMITRE ATT&CK: {technique_id}" if technique_id else "")
        ),
        "is_scheduled": "1",
        "actions": "",
        "disabled": "0",
    }

    endpoint = url.rstrip("/") + "/services/saved/searches"
    try:
        resp = requests.post(endpoint, headers=headers, data=payload, timeout=15, verify=True)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Splunk POST failed: {exc!r}"}

    if resp.status_code >= 400:
        return {
            "error": f"Splunk returned HTTP {resp.status_code}",
            "body": resp.text[:1000],
        }
    return {
        "status": "pushed",
        "splunk_savedsearch_name": safe_title,
        "engagement_slug": engagement_slug(),
        "technique_id": technique_id,
        "severity": severity,
    }
