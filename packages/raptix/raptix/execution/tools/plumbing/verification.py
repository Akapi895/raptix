"""Workspace-first finding verification without a knowledge-graph dependency."""

from __future__ import annotations

import json
import os
from typing import Annotated, Any

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from raptix.execution.tools.bash.bash import get_sandbox
from raptix.execution.tools.research.poc import parse_cvss_vector, sandbox_runner, validate_poc


def _patterns(raw: str) -> list[str]:
    return [pattern.strip() for pattern in raw.split(",") if pattern.strip()]


def _capture_enabled() -> bool:
    return os.environ.get("RAPTIX_KG_EVIDENCE_CAPTURE", "0").lower() in {"1", "true", "yes"}


def _retain_verification_ref(
    *,
    state: dict[str, Any] | None,
    sandbox: Any,
    commands: dict[str, tuple[str, str, int]],
    poc_command: str,
    negative_command: str,
    success_patterns: list[str],
    negative_patterns: list[str],
) -> str | None:
    """Retain the proof/control outputs and return one verification reference.

    Best-effort and flag-gated: any failure leaves the verification result
    unchanged and simply omits the reference.
    """
    if not _capture_enabled() or not negative_command:
        return None
    from raptix.execution.tools.evidence.artifacts import record_verification, retain_capture
    from raptix.middleware.filesystem import _normalize_engagement_workspace

    scope = state or {}
    workspace = _normalize_engagement_workspace(scope.get("workspace_path"))
    engagement = scope.get("kg_engagement") or scope.get("engagement_name")
    proof = commands.get(poc_command)
    control = commands.get(negative_command)
    if not (
        isinstance(workspace, str)
        and isinstance(engagement, str)
        and engagement
        and proof is not None
        and control is not None
    ):
        return None
    try:
        proof_ref = retain_capture(
            f"{proof[0]}\n{proof[1]}".encode("utf-8"),
            sandbox=sandbox,
            workspace=workspace,
            engagement=engagement,
            producer="validate_workspace_finding",
        )
        control_ref = retain_capture(
            f"{control[0]}\n{control[1]}".encode("utf-8"),
            sandbox=sandbox,
            workspace=workspace,
            engagement=engagement,
            producer="validate_workspace_finding",
        )
        return record_verification(
            proof_ref=proof_ref,
            control_ref=control_ref,
            success_patterns=success_patterns,
            negative_patterns=negative_patterns,
            sandbox=sandbox,
            workspace=workspace,
            engagement=engagement,
            producer="validate_workspace_finding",
        )
    except Exception:  # noqa: BLE001 — retention is best-effort over the result
        return None


@tool
async def validate_workspace_finding(
    finding_id: str,
    poc_command: str,
    success_patterns: str,
    negative_command: str,
    negative_patterns: str,
    cvss_vector: str,
    state: Annotated[dict | None, InjectedState] = None,
) -> str:
    """Run a minimal PoC and its mandatory baseline control in the sandbox.

    This verifier is intentionally workspace-first: it does not depend on the
    deferred Neo4j integration and does not promote a graph node.  Persist the
    returned JSON in the finding's evidence directory before reporting a
    validated result.

    ``success_patterns`` and ``negative_patterns`` are comma-separated Python
    regular expressions.  A result validates only when the positive command
    matches a success pattern, the baseline matches a baseline pattern, and the
    baseline does not match any success pattern.

    With ``RAPTIX_KG_EVIDENCE_CAPTURE=1`` (and an engagement workspace on state)
    the two outputs are retained and the JSON gains a ``verification_ref``; put
    it on the finding node's props so ``inspect_evidence`` can re-derive the
    differential outcome later.
    """
    required = {
        "finding_id": finding_id,
        "poc_command": poc_command,
        "success_patterns": success_patterns,
        "negative_command": negative_command,
        "negative_patterns": negative_patterns,
        "cvss_vector": cvss_vector,
    }
    empty = [name for name, value in required.items() if not value or not value.strip()]
    if empty:
        return json.dumps(
            {"error": "mandatory verification fields are missing", "fields": empty},
            sort_keys=True,
        )
    sandbox = get_sandbox()
    if sandbox is None:
        return json.dumps({"error": "HTTPSandbox not initialized"}, sort_keys=True)
    try:
        cvss = parse_cvss_vector(cvss_vector)
    except ValueError as exc:
        return json.dumps({"error": f"bad CVSS vector: {exc}"}, sort_keys=True)
    positive = _patterns(success_patterns)
    negative = _patterns(negative_patterns)
    if not positive or not negative:
        return json.dumps(
            {"error": "success_patterns and negative_patterns must each contain a pattern"},
            sort_keys=True,
        )
    commands: dict[str, tuple[str, str, int]] = {}
    base_runner = sandbox_runner(sandbox)

    async def _capturing(command: str) -> tuple[str, str, int]:
        output = await base_runner(command)
        commands[command] = output
        return output

    result = await validate_poc(
        vuln_id=finding_id,
        poc_command=poc_command,
        success_patterns=positive,
        runner=_capturing,
        negative_command=negative_command,
        negative_patterns=negative,
        cvss=cvss,
    )
    payload = result.to_dict()
    verification_ref = _retain_verification_ref(
        state=state,
        sandbox=sandbox,
        commands=commands,
        poc_command=poc_command,
        negative_command=negative_command,
        success_patterns=positive,
        negative_patterns=negative,
    )
    if verification_ref is not None:
        payload["verification_ref"] = verification_ref
    return json.dumps(payload, sort_keys=True)


WORKSPACE_VERIFICATION_TOOLS = [validate_workspace_finding]
