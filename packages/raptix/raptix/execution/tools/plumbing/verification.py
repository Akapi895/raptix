"""Workspace-first finding verification without a knowledge-graph dependency."""

from __future__ import annotations

import json
import os
from typing import Annotated, Any
from uuid import uuid4

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from raptix.execution.tools.bash.bash import get_sandbox
from raptix.execution.tools.research.poc import (
    execution_status,
    parse_cvss_vector,
    sandbox_runner,
    validate_poc,
)
from raptix.specialist_contracts.evidence import validate_evidence
from raptix_core.utils.logging import get_logger

log = get_logger("verification.workspace")


def _patterns(raw: str) -> list[str]:
    return [pattern.strip() for pattern in raw.split(",") if pattern.strip()]


def _capture_enabled() -> bool:
    return os.environ.get("RAPTIX_KG_EVIDENCE_CAPTURE", "0").lower() in {"1", "true", "yes"}


def _retain_verification_ref(
    *,
    state: dict[str, Any] | None,
    sandbox: Any,
    outputs: list[tuple[str, str, int]],
    finding_id: str,
    execution: dict[str, Any],
    workspace: str | None,
    config: RunnableConfig,
    success_patterns: list[str],
    negative_patterns: list[str],
) -> str | None:
    """Retain the proof/control outputs and return one verification reference.

    Best-effort and flag-gated: any failure leaves the verification result
    unchanged and simply omits the reference.
    """
    if not _capture_enabled() or len(outputs) != 2:
        return None
    from raptix.execution.tools.evidence.artifacts import record_verification, retain_capture

    scope = state or {}
    engagement = scope.get("kg_engagement") or scope.get("engagement_name")
    proof, control = outputs
    if not (
        isinstance(workspace, str)
        and isinstance(engagement, str)
        and engagement
        and (config.get("configurable") or {}).get("sandbox_url")
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
            finding_id=finding_id,
            execution=execution,
            invocation_id=str(config.get("run_id") or uuid4()),
        )
    except Exception as exc:  # noqa: BLE001 — retention is best-effort over the result
        log.debug("Verification retention unavailable (%s)", type(exc).__name__)
        return None


@tool
async def validate_workspace_finding(
    finding_id: str,
    poc_command: str,
    success_patterns: str,
    negative_command: str,
    negative_patterns: str,
    cvss_vector: str,
    config: RunnableConfig,
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

    With ``RAPTIX_KG_EVIDENCE_CAPTURE=1`` and explicit run context, retain both
    runner outputs and include ``verification_ref`` in the JSON persisted at
    ``findings/evidence/<finding_id>_verification.json``. A1 rechecks that file;
    it does not require a KG node. Incomplete or unsuccessful execution cannot
    validate a finding even when output contains a success marker.
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
    from raptix.middleware.filesystem import _normalize_engagement_workspace

    configurable = (config or {}).get("configurable") or {}
    raw_workspace = configurable.get("workspace_path") or (state or {}).get("workspace_path")
    if raw_workspace is not None and not isinstance(raw_workspace, str):
        return json.dumps({"error": "invalid_workspace"}, sort_keys=True)
    workspace = _normalize_engagement_workspace(raw_workspace)
    if raw_workspace is not None and workspace is None:
        return json.dumps({"error": "invalid_workspace"}, sort_keys=True)
    url = configurable.get("sandbox_url")
    if url is not None and (not isinstance(url, str) or not url):
        return json.dumps({"error": "invalid_sandbox_url"}, sort_keys=True)
    sandbox = get_sandbox(config) if url else get_sandbox()
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
    outputs: list[tuple[str, str, int]] = []
    base_runner = sandbox_runner(sandbox, workspace_path=workspace)

    async def _capturing(command: str) -> tuple[str, str, int]:
        output = await base_runner(command)
        outputs.append(output)
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
    proof, control = outputs
    execution = {"proof": execution_status(proof), "control": execution_status(control)}
    strict = validate_evidence(
        f"{proof[0]}\n{proof[1]}",
        f"{control[0]}\n{control[1]}",
        success_patterns=positive,
        negative_patterns=negative,
    )
    payload["validated"] = strict.validated and all(
        step["complete"] and step["exit_code"] == 0 for step in execution.values()
    )
    payload["verification_execution"] = execution
    verification_ref = _retain_verification_ref(
        state=state,
        sandbox=sandbox,
        outputs=outputs,
        finding_id=finding_id,
        execution=execution,
        workspace=workspace,
        config=config,
        success_patterns=positive,
        negative_patterns=negative,
    )
    if verification_ref is not None:
        payload["verification_ref"] = verification_ref
    return json.dumps(payload, sort_keys=True)


WORKSPACE_VERIFICATION_TOOLS = [validate_workspace_finding]
