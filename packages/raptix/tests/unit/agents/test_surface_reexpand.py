from __future__ import annotations

from pathlib import Path
from typing import Any

from raptix.agents.standard._surface_reexpand import (
    DEFAULT_MAX_GENERATIONS,
    DEFAULT_MAX_TOTAL_CELLS,
    plan_reexpansion,
)
from raptix.agents.standard._surface_registry import (
    build_coverage_matrix,
    surfaces_from_kg_inventory,
)

_PROMPT = (
    Path(__file__).resolve().parents[5]
    / "packages/raptix/raptix/agents/prompts/standard/decepticon.md"
)


def _cell(cell_id: str, *, gen: int = 0, priority: int = 1) -> dict[str, Any]:
    return {
        "cell_id": cell_id,
        "vuln_class": "sqli",
        "surface_key": f"endpoint::{cell_id}",
        "skill_path": "/skills/standard/surface_exploit/sqli/SKILL.md",
        "session_name": f"se-{cell_id}",
        "gen": gen,
        "priority": priority,
    }


def test_plan_reexpansion_deduplicates_existing_cells_regardless_of_status() -> None:
    existing = [
        {"id": "OBJ-002", "status": "completed", "notes": "cell_id=known"},
        {"id": "OBJ-003", "status": "blocked", "notes": "cell_id=blocked"},
    ]

    result = plan_reexpansion(existing, [_cell("known"), _cell("blocked"), _cell("new")])

    assert [cell["cell_id"] for cell in result] == ["new"]


def test_plan_reexpansion_drops_generation_over_bound() -> None:
    result = plan_reexpansion(
        [],
        [_cell("gen-1", gen=1), _cell("gen-4", gen=4)],
        max_generations=3,
    )

    assert [cell["cell_id"] for cell in result] == ["gen-1"]


def test_plan_reexpansion_hard_caps_total_cells_with_priority_then_generation() -> None:
    result = plan_reexpansion(
        [{"id": "OBJ-001", "notes": "cell_id=existing"}],
        [
            _cell("late", gen=1, priority=2),
            _cell("early", gen=0, priority=1),
            _cell("over-cap", gen=0, priority=3),
        ],
        max_total_cells=3,
    )

    assert [cell["cell_id"] for cell in result] == ["early", "late"]
    assert len(result) + 1 == 3


def test_plan_reexpansion_returns_empty_when_no_valid_new_surface_exists() -> None:
    assert plan_reexpansion([], []) == []
    assert plan_reexpansion([], [_cell("too-deep", gen=4)], max_generations=3) == []
    assert plan_reexpansion([{"notes": "cell_id=known"}], [_cell("known")]) == []


def test_kg_inventory_round_trip_preserves_generation_and_deduplicates_cells() -> None:
    rows = [
        {
            "key": "endpoint::GET::https://app.test/new?q=1",
            "props": {
                "url": "https://app.test/new?q=1",
                "path": "/new",
                "gen": 1,
                "discovered_by": "surface_exploit",
                "via_cell": "sqli::endpoint::GET::https://app.test/origin",
            },
            "children": [
                {
                    "kind": "Parameter",
                    "key": "parameter::q",
                    "label": "q",
                    "props": {"name": "q"},
                }
            ],
        }
    ]
    derived_cells = build_coverage_matrix(surfaces_from_kg_inventory(rows))
    existing = [{"status": "completed", "notes": f"cell_id={derived_cells[0]['cell_id']}"}]

    result = plan_reexpansion(existing, derived_cells)

    assert {cell["cell_id"] for cell in result} == {cell["cell_id"] for cell in derived_cells[1:]}
    assert {cell["gen"] for cell in result} == {1}
    assert result[0]["via_cell"] == "sqli::endpoint::GET::https://app.test/origin"


def test_reexpansion_converges_after_one_new_generation() -> None:
    derived = [_cell("new-surface", gen=1)]
    first = plan_reexpansion([], derived)
    second = plan_reexpansion(first, derived)

    assert [cell["cell_id"] for cell in first] == ["new-surface"]
    assert second == []
    assert DEFAULT_MAX_GENERATIONS == 3
    assert DEFAULT_MAX_TOTAL_CELLS == 50


def test_prompt_requires_confirmed_only_bounded_reexpansion() -> None:
    prompt = _PROMPT.read_text(encoding="utf-8").lower()

    assert "only after confirmed" in prompt
    assert 'one task("surface_exploit")' in prompt
    assert "gated on the adr-0021 live runbook" in prompt
