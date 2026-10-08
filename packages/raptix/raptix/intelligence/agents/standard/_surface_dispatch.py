"""Deterministic selection and task payloads for surface-exploit cells."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

SURFACE_EXPLOIT_OWNER = "surface_exploit"
DEFAULT_MAX_IN_FLIGHT = 3
SURFACE_EXPLOIT_OUTCOME_STATUS = {
    "confirmed": "completed",
    "ruled_out": "completed",
    "open_proof_gap": "in-progress",
}

_TITLE_RE = re.compile(r"^Surface exploit: (?P<vuln_class>[a-z0-9_]+) @ (?P<surface_key>.+)$")
_SESSION_RE = re.compile(r"(?:^|;\s*)session_name=(?P<session_name>[^;\s]+)")
_SKILL_RE = re.compile(r"load (?P<skill_path>/skills/\S+?SKILL\.md)")


def _priority(objective: Mapping[str, Any]) -> tuple[int, str]:
    try:
        priority = int(objective.get("priority", 2**31 - 1))
    except (TypeError, ValueError):
        priority = 2**31 - 1
    return priority, str(objective.get("id", ""))


def _pending_surface_exploit_cells(
    objectives: Sequence[Mapping[str, Any]],
) -> list[Mapping[str, Any]]:
    return sorted(
        (
            objective
            for objective in objectives
            if objective.get("owner") == SURFACE_EXPLOIT_OWNER
            and objective.get("status") == "pending"
        ),
        key=_priority,
    )


def _surface_exploit_payload(objective: Mapping[str, Any]) -> dict[str, str]:
    title = str(objective.get("title", ""))
    description = str(objective.get("description", ""))
    notes = str(objective.get("notes", ""))
    title_match = _TITLE_RE.fullmatch(title)
    session_match = _SESSION_RE.search(notes)
    skill_match = _SKILL_RE.search(description)
    objective_id = str(objective.get("id", ""))
    if not objective_id or title_match is None or session_match is None or skill_match is None:
        raise ValueError(
            f"surface-exploit objective {objective_id or '<missing id>'} lacks B5 cell metadata"
        )

    vuln_class = title_match["vuln_class"]
    surface_key = title_match["surface_key"]
    session_name = session_match["session_name"]
    skill_path = skill_match["skill_path"]
    return {
        "objective_id": objective_id,
        "vuln_class": vuln_class,
        "surface_key": surface_key,
        "session_name": session_name,
        "skill_path": skill_path,
        "task_description": (
            f"Coverage cell {objective_id}: test only {vuln_class} against {surface_key}. "
            f"Use bash session {session_name} for every command. Load {skill_path} before "
            "the first probe. Return exactly one outcome: confirmed, ruled_out, or "
            "open_proof_gap, with KG evidence."
        ),
    }


def next_surface_exploit_dispatch(objectives: Sequence[Mapping[str, Any]]) -> dict[str, str] | None:
    """Return the one highest-priority pending surface-exploit task payload."""
    pending = _pending_surface_exploit_cells(objectives)
    if not pending:
        return None
    return _surface_exploit_payload(pending[0])


def next_surface_exploit_batch(
    objectives: Sequence[Mapping[str, Any]],
    *,
    max_in_flight: int = DEFAULT_MAX_IN_FLIGHT,
) -> list[dict[str, str]]:
    """Return a bounded, priority-ordered batch of pending surface-exploit cells."""
    if max_in_flight < 1:
        raise ValueError("max_in_flight must be at least one")
    payloads = [
        _surface_exploit_payload(objective)
        for objective in _pending_surface_exploit_cells(objectives)[:max_in_flight]
    ]
    sessions = [payload["session_name"] for payload in payloads]
    assert len(sessions) == len(set(sessions)), "surface-exploit batch requires distinct sessions"
    return payloads
