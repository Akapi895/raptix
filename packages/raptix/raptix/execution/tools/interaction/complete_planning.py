"""complete_engagement_planning — validate and signal the planning handoff."""

from __future__ import annotations

import json
import posixpath
from pathlib import Path
from typing import Annotated, Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.config import get_config, get_stream_writer
from pydantic import ValidationError

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

_PLANNING_DOCUMENTS = {
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


def validate_planning_bundle(
    workspace: str | Path,
    *,
    target_value: str = "",
    authorization_confirmed: bool | None = None,
) -> str | None:
    """Return every reason the eight-document planner bundle is not ready, or None.

    All documents are checked before returning, so the planner can fix the whole
    bundle in one pass instead of one error per handoff attempt.
    """
    if authorization_confirmed is False:
        return "Authorization is not confirmed; do not hand off the engagement."

    root = Path(workspace)
    documents: dict[str, Any] = {}
    problems: list[str] = []
    for filename, model in _PLANNING_DOCUMENTS.items():
        path = root / "plan" / filename
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            problems.append(f"plan/{filename}: missing; write this document")
            continue
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            problems.append(f"plan/{filename}: not valid JSON ({exc})")
            continue
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
    root = f"/workspace/{next(iter(names))}"
    if posixpath.normpath(evidence) != root and not posixpath.normpath(evidence).startswith(f"{root}/"):
        return (
            f"plan/data-handling.json: evidence_storage_path must be inside {root}/ "
            f"(got {evidence!r}). Write the concrete path, for example {root}/evidence/."
        )

    roe = documents["roe.json"]
    if not roe.authorization_reference.strip():
        return "RoE must contain an explicit authorization_reference before handoff."
    if target_value and target_value not in {entry.target for entry in roe.in_scope}:
        return "RoE in_scope must contain the exact launcher-declared target."
    return None


def _runtime_context() -> tuple[str, str, bool | None]:
    try:
        configurable = get_config().get("configurable", {})
    except RuntimeError:
        configurable = {}
    if not isinstance(configurable, dict):
        configurable = {}
    workspace = configurable.get("workspace_path")
    target = configurable.get("target_value")
    confirmed = configurable.get("authorization_confirmed")
    return (
        workspace if isinstance(workspace, str) and workspace else "/workspace",
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
    workspace, target_value, authorization_confirmed = _runtime_context()
    failure = validate_planning_bundle(
        workspace,
        target_value=target_value,
        authorization_confirmed=authorization_confirmed,
    )
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
