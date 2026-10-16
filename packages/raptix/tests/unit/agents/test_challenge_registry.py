"""Unit tests for the scoreboard-derived per-challenge registry."""

from __future__ import annotations

import json
from pathlib import Path

from raptix.intelligence.agents.standard import _challenge_registry as registry
from raptix.intelligence.agents.standard._surface_dispatch import (
    _SKILL_RE,
    _TITLE_RE,
)
from raptix.intelligence.agents.standard._surface_reexpand import plan_reexpansion

_MODULE_SOURCE = Path(registry.__file__).read_text(encoding="utf-8")

_SNAPSHOT = {
    "status": "success",
    "data": [
        {
            "id": 1,
            "key": "alphaLeakChallenge",
            "name": "Alpha Leak",
            "category": "Sensitive Data Exposure",
            "difficulty": 2,
            "solved": False,
        },
        {
            "id": 2,
            "key": "betaReflectedXssChallenge",
            "name": "Beta Reflected",
            "category": "XSS",
            "difficulty": 1,
            "solved": False,
        },
        {
            "id": 3,
            "key": "gammaStoredXssChallenge",
            "name": "Gamma Stored",
            "category": "XSS",
            "difficulty": 4,
            "solved": True,
        },
        {
            "id": 4,
            "key": "deltaBombChallenge",
            "name": "Delta Bomb",
            "category": "Insecure Deserialization",
            "difficulty": 5,
            "solved": False,
        },
        {
            "id": 5,
            "key": "epsilonResetChallenge",
            "name": "Epsilon Reset",
            "category": "Broken Authentication",
            "difficulty": 3,
            "solved": False,
        },
        {"id": 6, "name": "Broken Row"},
    ],
}


def test_skill_rules_match_category_variants() -> None:
    assert registry.skill_for_category("Cross-Site Scripting (XSS)").endswith("web/xss/SKILL.md")
    assert registry.skill_for_category("XSS").endswith("web/xss/SKILL.md")
    assert registry.skill_for_category("Sensitive Data Exposure").endswith(
        "sensitive-information-disclosure/SKILL.md"
    )
    assert registry.skill_for_category("Insecure Deserialisation").endswith(
        "web/deserialization/SKILL.md"
    )
    assert registry.skill_for_category("XML External Entity").endswith("web/xxe/SKILL.md")
    assert registry.skill_for_category("Chatbot Prompt Injection").endswith(
        "analyst/prompt-injection/SKILL.md"
    )


def test_unknown_category_falls_back_to_generic_skill() -> None:
    assert registry.skill_for_category("Mystery Family 9000") == registry.DEFAULT_SKILL_PATH


def test_roe_gated_category_detection() -> None:
    assert registry.is_roe_gated_category("Insecure Deserialization")
    assert not registry.is_roe_gated_category("XSS")


def test_parse_snapshot_accepts_envelope_and_bare_list() -> None:
    rows = registry.parse_challenge_snapshot(json.dumps(_SNAPSHOT))
    assert [row["name"] for row in rows] == [
        "Alpha Leak",
        "Beta Reflected",
        "Gamma Stored",
        "Delta Bomb",
        "Epsilon Reset",
    ]
    assert rows[0]["key"] == "alphaLeakChallenge"
    bare = registry.parse_challenge_snapshot(json.dumps(_SNAPSHOT["data"]))
    assert len(bare) == 5
    assert registry.parse_challenge_snapshot("not json") == []


def _cells() -> list[dict]:
    challenges = registry.parse_challenge_snapshot(json.dumps(_SNAPSHOT))
    return registry.build_challenge_cells(challenges)


def test_one_cell_per_unsolved_entry() -> None:
    cells = _cells()
    assert len(cells) == 4  # the solved entry produces no cell
    names = {cell["challenge_name"] for cell in cells}
    assert names == {"Alpha Leak", "Beta Reflected", "Delta Bomb", "Epsilon Reset"}
    assert all(cell["challenge_id"] for cell in cells)


def test_priority_is_target_difficulty_and_gated_entries_sort_last() -> None:
    cells = _cells()
    by_name = {cell["challenge_name"]: cell for cell in cells}
    assert by_name["Beta Reflected"]["priority"] == 1
    assert by_name["Alpha Leak"]["priority"] == 2
    gated = by_name["Delta Bomb"]
    assert gated["roe_gated"] is True
    assert gated["priority"] >= registry.ROE_GATED_PRIORITY
    ordered = sorted(cells, key=lambda cell: cell["priority"])
    assert ordered[-1]["challenge_name"] == "Delta Bomb"


def test_cell_identity_and_session_are_deterministic() -> None:
    first = _cells()
    second = _cells()
    assert [cell["cell_id"] for cell in first] == [cell["cell_id"] for cell in second]
    for cell in first:
        assert cell["cell_id"].startswith(f"{cell['vuln_class']}::")
        assert cell["session_name"].startswith("se-")


def test_children_payload_matches_dispatch_contract() -> None:
    children = registry.build_challenge_children(_cells())
    assert children
    for child in children:
        match = _TITLE_RE.fullmatch(child["title"])
        assert match is not None
        skill_match = _SKILL_RE.search(child["description"])
        assert skill_match is not None
        assert skill_match["skill_path"].endswith("SKILL.md")
        assert "cell_id=" in child["notes"]
        assert "session_name=" in child["notes"]
        assert "gen=0" in child["notes"]
        assert "challenge_id=" in child["notes"]
        assert "challenge_name=" in child["notes"]
        assert child["owner"] == "surface_exploit"
        # skip outcomes require bounded empirical evidence
        assert any("evidence" in criterion.lower() for criterion in child["acceptance_criteria"])


def test_plan_reexpansion_deduplicates_existing_cells_per_challenge() -> None:
    cells = _cells()
    first = cells[0]
    existing = [{"status": "completed", "notes": f"cell_id={first['cell_id']}; session_name=x"}]
    selected = plan_reexpansion(existing, cells)
    assert first["cell_id"] not in {cell["cell_id"] for cell in selected}
    assert len(selected) == len(cells) - 1


def test_registry_stays_free_of_target_specific_content_and_hints() -> None:
    # Objectivity contract (docs/adr/0075): no payloads, endpoints,
    # credentials, target names — and no hint ingestion (discovery mode).
    forbidden = ("juice", "owasp", "/rest/", "/ftp", "coupon")
    lowered = _MODULE_SOURCE.lower()
    for token in forbidden:
        assert token not in lowered, f"target-specific token {token!r} found in registry"
    # No functional hint plumbing may exist (the docstring may still
    # describe the no-hints policy).
    for marker in ("parse_hints", "hints=", "_hints_note", "_hints_snapshot"):
        assert marker not in lowered, f"hint plumbing {marker!r} found in registry"
