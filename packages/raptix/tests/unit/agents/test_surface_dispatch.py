from __future__ import annotations

from pathlib import Path
from typing import Any

from raptix.agents.standard._surface_dispatch import (
    SURFACE_EXPLOIT_OUTCOME_STATUS,
    next_surface_exploit_dispatch,
)
from raptix.agents.standard._surface_registry import build_objective_expand_payload

_PROMPT = (
    Path(__file__).resolve().parents[5]
    / "packages/raptix/raptix/agents/prompts/standard/decepticon.md"
)


def _cell_objectives() -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = [
        {
            "cell_id": "sqli::endpoint::GET::https://app.test/search",
            "vuln_class": "sqli",
            "surface_key": "endpoint::GET::https://app.test/search",
            "skill_path": "/skills/standard/surface_exploit/sqli/SKILL.md",
            "mitre": "T1190",
            "session_name": "se-sqli",
        },
        {
            "cell_id": "xss::endpoint::GET::https://app.test/search",
            "vuln_class": "xss",
            "surface_key": "endpoint::GET::https://app.test/search",
            "skill_path": "/skills/standard/surface_exploit/xss/SKILL.md",
            "mitre": "T1190",
            "session_name": "se-xss",
        },
    ]
    children = build_objective_expand_payload("OBJ-001", cells)["children"]
    return [
        {"id": "OBJ-003", "status": "pending", **children[1]},
        {"id": "OBJ-002", "status": "pending", **children[0]},
    ]


def test_next_surface_dispatch_selects_one_pending_cell_with_b5_metadata() -> None:
    payload = next_surface_exploit_dispatch(_cell_objectives())

    assert payload == {
        "objective_id": "OBJ-002",
        "vuln_class": "sqli",
        "surface_key": "endpoint::GET::https://app.test/search",
        "session_name": "se-sqli",
        "skill_path": "/skills/standard/surface_exploit/sqli/SKILL.md",
        "task_description": (
            "Coverage cell OBJ-002: test only sqli against "
            "endpoint::GET::https://app.test/search. Use bash session se-sqli for every "
            "command. Load /skills/standard/surface_exploit/sqli/SKILL.md before the first "
            "probe. Return exactly one outcome: confirmed, ruled_out, or open_proof_gap, "
            "with KG evidence."
        ),
    }


def test_next_surface_dispatch_skips_terminal_cells_and_stops_when_none_pending() -> None:
    objectives = _cell_objectives()
    objectives[1]["status"] = "completed"

    next_payload = next_surface_exploit_dispatch(objectives)
    assert next_payload is not None
    assert next_payload["objective_id"] == "OBJ-003"
    for terminal_status in ("completed", "blocked", "cancelled"):
        objectives[0]["status"] = terminal_status
        assert next_surface_exploit_dispatch(objectives) is None


def test_surface_exploit_outcomes_follow_opplan_transitions() -> None:
    assert SURFACE_EXPLOIT_OUTCOME_STATUS == {
        "confirmed": "completed",
        "ruled_out": "completed",
        "open_proof_gap": "in-progress",
    }


def test_orchestrator_prompt_limits_surface_exploit_to_one_sequential_task() -> None:
    prompt = _PROMPT.read_text(encoding="utf-8")

    assert 'exactly ONE `task("surface_exploit", ...)`' in prompt
    assert "Parallel fan-out is gated on the ADR-0021 live runbook" in prompt
    assert "`open_proof_gap` remains `in-progress`" in prompt
