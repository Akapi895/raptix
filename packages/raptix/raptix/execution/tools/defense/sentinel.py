"""Sigma → Microsoft Sentinel Analytic Rule (ARM-based push), via pySigma.

Sentinel Analytic Rules live under
``Microsoft.SecurityInsights/scheduledAlertRules``. We assemble a minimal
ARM resource and PUT it via the Azure Management REST API.

Authentication: ConOps.blue_team.sentinel.auth = "oauth:AZURE_BEARER_TOKEN".
The bearer token is acquired by the operator out-of-band (via
``az account get-access-token --resource https://management.azure.com``)
and exported into the env var named in the ConOps auth spec.

We translate the Sigma detection body to KQL using the official ``pySigma``
engine + the ``pySigma-backend-kusto`` ``sentinel_asim`` pipeline. Earlier
versions hand-rolled a logsource→table lookup (e.g. every Windows rule went
to the generic ``SecurityEvent`` table) with Sigma's raw field names passed
straight through — against a real ASIM-normalized workspace that produces a
query that parses but matches nothing (the ASIM table for process creation
is ``imProcessCreate`` with fields like ``TargetProcessName``, not
``SecurityEvent``/``Image``). The ASIM pipeline resolves both the table and
the field names from the Sigma logsource/field taxonomy.
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
from sigma.backends.kusto.kusto import KustoBackend
from sigma.collection import SigmaCollection
from sigma.exceptions import SigmaError
from sigma.pipelines.sentinelasim import sentinel_asim_pipeline


class SigmaToKqlError(RuntimeError):
    """Raised when pySigma can't translate a Sigma rule to KQL."""


def sigma_to_kql(sigma_rule: dict[str, Any]) -> str:
    """Translate a Sigma rule dict to a KQL query string for Sentinel via pySigma.

    Applies the Sentinel ASIM pipeline, which resolves both the target ASIM
    table (e.g. ``imProcessCreate``) and the field-name mapping from the
    rule's logsource/fields — the hand-rolled predecessor did neither.
    Raises SigmaToKqlError — not a raw pySigma exception — so callers keep
    one exception type to catch.
    """
    try:
        collection = SigmaCollection.from_dicts([sigma_rule])
        queries = KustoBackend(processing_pipeline=sentinel_asim_pipeline()).convert(collection)
    except SigmaError as exc:
        raise SigmaToKqlError(str(exc)) from exc
    if not queries:
        raise SigmaToKqlError("pySigma produced no KQL query for this rule")
    return str(queries[0])


_SEVERITY_MAP = {
    "informational": "Informational",
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "critical": "High",
}


def push_analytic_rule(
    rule_id: str,
    display_name: str,
    kql_query: str,
    *,
    description: str = "",
    severity: str = "medium",
    technique_id: str = "",
) -> dict[str, Any]:
    """PUT a Scheduled Analytic Rule into Microsoft Sentinel via Azure Management REST."""
    try:
        target = resolve_siem_target("sentinel")
    except ConOpsLookupError as exc:
        return {"error": str(exc)}

    subscription = target.get("subscription_id")
    resource_group = target.get("resource_group")
    workspace = target.get("workspace_name")
    auth_spec = target.get("auth")
    if not all([subscription, resource_group, workspace, auth_spec]):
        return {
            "error": (
                "ConOps.blue_team.sentinel must define subscription_id, "
                "resource_group, workspace_name, and auth"
            )
        }
    try:
        bearer = resolve_auth_value(auth_spec)
    except ConOpsLookupError as exc:
        return {"error": str(exc)}

    tagged_id = f"raptix-eng-{engagement_slug()}-{rule_id}"
    api_version = "2024-09-01"
    url = (
        f"https://management.azure.com/subscriptions/{subscription}"
        f"/resourceGroups/{resource_group}/providers/Microsoft.OperationalInsights"
        f"/workspaces/{workspace}/providers/Microsoft.SecurityInsights"
        f"/alertRules/{tagged_id}?api-version={api_version}"
    )

    body: dict[str, Any] = {
        "kind": "Scheduled",
        "properties": {
            "displayName": f"[Raptix] {display_name}",
            "description": (
                description
                + f"\n\nEngagement: {engagement_slug()}"
                + (f"\nMITRE ATT&CK: {technique_id}" if technique_id else "")
            ),
            "severity": _SEVERITY_MAP.get(severity.lower(), "Medium"),
            "enabled": True,
            "query": kql_query,
            "queryFrequency": "PT5M",
            "queryPeriod": "PT5M",
            "triggerOperator": "GreaterThan",
            "triggerThreshold": 0,
            "suppressionDuration": "PT5H",
            "suppressionEnabled": False,
            "tactics": [],
        },
    }
    if technique_id:
        body["properties"]["techniques"] = [technique_id]

    try:
        import requests  # noqa: PLC0415
    except ImportError:
        return {"error": "``requests`` not installed in langgraph container"}

    headers = {
        "Authorization": f"Bearer {bearer}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.put(url, headers=headers, data=json.dumps(body), timeout=15)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"Sentinel PUT failed: {exc!r}"}

    if resp.status_code >= 400:
        return {
            "error": f"Sentinel returned HTTP {resp.status_code}",
            "body": resp.text[:1000],
        }
    return {
        "status": "pushed",
        "rule_id": tagged_id,
        "engagement_slug": engagement_slug(),
        "technique_id": technique_id,
        "severity": severity,
    }
