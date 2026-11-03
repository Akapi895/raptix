"""complete_engagement_planning — validate and signal the planning handoff."""

from __future__ import annotations

import json
import posixpath
from typing import Annotated, Any
from urllib.parse import urlsplit

from langchain_core.messages import ToolMessage
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.config import get_config, get_stream_writer
from pydantic import ValidationError

from raptix.execution.backends.project_files import (
    WORKSPACE_ROOT,
    ProjectFiles,
    ProjectFileUnavailable,
    ambient_project_files,
)
from raptix_core.types.engagement import (
    CONOPS,
    AbortPlan,
    CleanupPlan,
    ContactPlan,
    DataHandlingPlan,
    DeconflictionPlan,
    RoE,
    ThreatProfile,
)
from raptix_core.types.roe import MachineEnforcement, evaluate_target

PLANNING_DOCUMENTS = {
    "roe.json": RoE,
    "threat-profile.json": ThreatProfile,
    "conops.json": CONOPS,
    "deconfliction.json": DeconflictionPlan,
    "contact.json": ContactPlan,
    "data-handling.json": DataHandlingPlan,
    "abort.json": AbortPlan,
    "cleanup.json": CleanupPlan,
}


def _schema_issues(error: ValidationError) -> list[str]:
    """One line per schema error: the field path, the rule, and the value that broke it."""
    issues = []
    for item in error.errors(include_url=False):
        location = ".".join(str(part) for part in item["loc"]) or "(document)"
        value = item.get("input")
        shown = f" (got {value!r})" if isinstance(value, str) and len(value) <= 60 else ""
        issues.append(f"{location}: {item['msg']}{shown}")
    return issues


def planning_document_issues(filename: str, text: str) -> list[str]:
    """Schema problems in one planner document's text; empty when it is valid."""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        return [f"not valid JSON ({exc})"]
    try:
        PLANNING_DOCUMENTS[filename].model_validate(payload)
    except ValidationError as exc:
        return _schema_issues(exc)
    return []


def validate_planning_bundle(
    files: ProjectFiles,
    *,
    target_value: str = "",
    authorization_confirmed: bool | None = None,
) -> str | None:
    """Return every reason the eight-document planner bundle is not ready, or None.

    All documents are checked before returning, so the planner can fix the whole
    bundle in one pass instead of one error per handoff attempt. The documents are
    read from the project's own sandbox (ADR-0102). An unreachable sandbox raises
    ProjectFileUnavailable, and nothing is handed off.
    """
    if authorization_confirmed is False:
        return "Authorization is not confirmed; do not hand off the engagement."

    payloads: dict[str, Any] = {}
    documents: dict[str, Any] = {}
    problems: list[str] = []
    for filename, model in PLANNING_DOCUMENTS.items():
        raw = files.read_bytes(f"plan/{filename}")
        if raw is None:
            problems.append(f"plan/{filename}: missing; write this document")
            continue
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            problems.append(f"plan/{filename}: not valid JSON ({exc})")
            continue
        payloads[filename] = payload
        try:
            documents[filename] = model.model_validate(payload)
        except ValidationError as exc:
            problems.extend(f"plan/{filename}: {issue}" for issue in _schema_issues(exc))
    if problems:
        return "\n".join(problems)

    names = {document.engagement_name.strip() for document in documents.values()}
    if len(names) != 1 or not next(iter(names), ""):
        return "Planning documents must share one non-empty engagement_name."

    evidence = documents["data-handling.json"].evidence_storage_path.strip()
    if posixpath.normpath(evidence) != WORKSPACE_ROOT and not posixpath.normpath(
        evidence
    ).startswith(f"{WORKSPACE_ROOT}/"):
        return (
            f"plan/data-handling.json: evidence_storage_path must be inside {WORKSPACE_ROOT}/ "
            f"(got {evidence!r}). Write the concrete path, for example {WORKSPACE_ROOT}/evidence/."
        )

    roe = documents["roe.json"]
    if not roe.authorization_reference.strip():
        return "RoE must contain an explicit authorization_reference before handoff."
    if target_value and target_value not in {entry.target for entry in roe.in_scope}:
        return "RoE in_scope must contain the exact launcher-declared target."
    return _machine_enforcement_problem(payloads["roe.json"], target_value)


def _machine_enforcement_problem(roe: dict[str, Any], target_value: str) -> str | None:
    """The runtime enforces scope only from plan/roe.json's machine_enforcement block, so handoff requires it.

    An enforce-mode block with an empty in_scope list would allow every target, so the list must not be empty.
    """
    block = roe.get("machine_enforcement")
    if not isinstance(block, dict):
        return (
            'plan/roe.json: machine_enforcement is required before handoff. Add the block with "mode": "enforce" '
            'and an "in_scope" list of the hosts, CIDRs or patterns the engagement may touch.'
        )
    if str(block.get("mode", "")).lower() != "enforce":
        return f'plan/roe.json: machine_enforcement.mode must be "enforce" before handoff (got {block.get("mode")!r}).'
    try:
        rules = MachineEnforcement.from_dict(block)
    except (TypeError, ValueError, KeyError) as exc:
        return f"plan/roe.json: machine_enforcement is malformed ({exc})."
    if not rules.in_scope:
        return (
            "plan/roe.json: machine_enforcement.in_scope must list at least one host, CIDR or pattern. "
            "An empty list allows every target."
        )
    if target_value:
        host = urlsplit(target_value).hostname or target_value
        decision = evaluate_target(host, rules)
        if not decision.allow:
            return (
                f"plan/roe.json: the launcher-declared target {host!r} is refused by machine_enforcement "
                f"({decision.reason_code}). Add it to machine_enforcement.in_scope."
            )
    return None


def _runtime_context() -> tuple[str, bool | None]:
    try:
        configurable = get_config().get("configurable", {})
    except RuntimeError:
        configurable = {}
    if not isinstance(configurable, dict):
        configurable = {}
    target = configurable.get("target_value")
    confirmed = configurable.get("authorization_confirmed")
    return (
        target if isinstance(target, str) else "",
        confirmed if isinstance(confirmed, bool) else None,
    )


def _safe_writer():
    try:
        return get_stream_writer()
    except Exception:
        return None


@tool
def complete_engagement_planning(
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Any:
    """Validate the full planner bundle and hand the engagement to Raptix.

    The event is emitted only after every Soundwave-owned document validates,
    the bundle shares an engagement name, the RoE records authorization, and
    any launcher-declared target appears exactly in RoE scope.
    """
    target_value, authorization_confirmed = _runtime_context()
    try:
        failure = validate_planning_bundle(
            ambient_project_files(),
            target_value=target_value,
            authorization_confirmed=authorization_confirmed,
        )
    except ProjectFileUnavailable as exc:
        failure = f"plan/: the project sandbox could not be read ({exc}). Retry once it is running."
    if failure:
        # An error status, not text: the planner's loop sees the block as a failed call
        # and gets the full list of what to fix.
        return ToolMessage(
            content=(
                "Planning handoff blocked. The engagement was not handed to Raptix. "
                "Fix each item below in the named file, then call this tool again:\n"
                f"{failure}"
            ),
            tool_call_id=tool_call_id or "",
            status="error",
        )
    writer = _safe_writer()
    if writer is not None:
        writer(
            {
                "type": "engagement_ready",
                "agent": "soundwave",
                "id": tool_call_id,
            }
        )
    return (
        "Planning complete. The operator's next message will be routed to the "
        "Raptix operations agent."
    )
