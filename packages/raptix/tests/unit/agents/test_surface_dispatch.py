from __future__ import annotations

from pathlib import Path
from typing import Any

from raptix.agents.standard._surface_dispatch import (
    DEFAULT_MAX_IN_FLIGHT,
    SURFACE_EXPLOIT_OUTCOME_STATUS,
    next_surface_exploit_batch,
    next_surface_exploit_dispatch,
)
from raptix.agents.standard._surface_registry import build_objective_expand_payload

_PROMPT = (
    Path(__file__).resolve().parents[5] / "packages/raptix/raptix/agents/prompts/standard/raptix.md"
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


def _batch_objective(
    objective_id: str,
    priority: int,
    vuln_class: str,
    session_name: str,
    *,
    status: str = "pending",
) -> dict[str, object]:
    surface = f"endpoint::GET::https://app.test/{vuln_class}"
    return {
        "id": objective_id,
        "owner": "surface_exploit",
        "status": status,
        "priority": priority,
        "title": f"Surface exploit: {vuln_class} @ {surface}",
        "description": f"load /skills/standard/surface_exploit/{vuln_class}/SKILL.md first.",
        "notes": f"session_name={session_name}",
    }


def test_next_surface_exploit_batch_is_priority_ordered_and_bounded() -> None:
    objectives = [
        _batch_objective("OBJ-4", 4, "ssrf", "se-ssrf"),
        _batch_objective("OBJ-2", 2, "xss", "se-xss"),
        _batch_objective("OBJ-1", 1, "sqli", "se-sqli"),
        _batch_objective("OBJ-3", 3, "idor", "se-idor"),
    ]

    batch = next_surface_exploit_batch(objectives)

    assert DEFAULT_MAX_IN_FLIGHT == 3
    assert [payload["objective_id"] for payload in batch] == ["OBJ-1", "OBJ-2", "OBJ-3"]
    assert len({payload["session_name"] for payload in batch}) == len(batch)


def test_next_surface_exploit_batch_skips_terminal_cells_and_stops_when_none_pending() -> None:
    objectives = [
        _batch_objective("OBJ-1", 1, "sqli", "se-sqli", status="completed"),
        _batch_objective("OBJ-2", 2, "xss", "se-xss", status="blocked"),
        _batch_objective("OBJ-3", 3, "idor", "se-idor", status="cancelled"),
        _batch_objective("OBJ-4", 4, "ssrf", "se-ssrf"),
    ]

    assert [payload["objective_id"] for payload in next_surface_exploit_batch(objectives)] == [
        "OBJ-4"
    ]
    objectives[-1]["status"] = "completed"
    assert next_surface_exploit_batch(objectives) == []


def test_next_surface_exploit_batch_of_one_matches_single_dispatch() -> None:
    objectives = _cell_objectives()

    assert next_surface_exploit_batch(objectives, max_in_flight=1) == [
        next_surface_exploit_dispatch(objectives)
    ]


def test_orchestrator_prompt_allows_bounded_parallel_surface_exploit_tasks() -> None:
    prompt = _PROMPT.read_text(encoding="utf-8")

    prompt_lower = prompt.lower()
    assert "max_in_flight" in prompt
    assert "up to 3 " in prompt
    assert "distinct session" in prompt_lower
    assert "authorized by adr-0021" in prompt_lower
    assert "sequential" in prompt_lower
    assert "per-cell re-expansion" in prompt_lower
