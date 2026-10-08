"""Tests for the lab harness's injection-protocol accounting (plan D7).

Covers _load_protocol validation, _merge_protocol's conflict refusal,
and the deterministic turn-delivery selection. Every operator injection
must land in exactly one auditable place (input/protocol.jsonl) and be
counted in the summary.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


def _load_harness():
    repo_root = Path(__file__).resolve().parents[5]
    harness = repo_root / "tests" / "local" / "harnesses" / "lab_run.py"
    spec = importlib.util.spec_from_file_location("lab_run_harness_g", harness)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


lab_run = _load_harness()
_load_protocol = lab_run._load_protocol
_merge_protocol = lab_run._merge_protocol
_injection_for_turn = lab_run._injection_for_turn


def _write(tmp_path: Path, records: list[dict]) -> Path:
    p = tmp_path / "protocol.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    return p


# -- parsing + validation --


def test_valid_protocol_parses(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        [
            {"turn": 0, "kind": "hint", "text": "flag format is HTB{...}", "source": "op"},
            {"turn": 3, "kind": "interference", "text": "the client called, escalate"},
            {"turn": -1, "kind": "proceed", "text": "continue"},
        ],
    )
    records = _load_protocol(path)
    assert [r["turn"] for r in records] == [0, 3, -1]
    assert records[0]["source"] == "op"
    assert records[2]["source"] == ""  # optional, defaults empty


def test_invalid_json_names_the_line(tmp_path: Path) -> None:
    path = tmp_path / "protocol.jsonl"
    path.write_text('{"turn": 0, "kind": "hint", "text": "ok"}\nnot json\n', encoding="utf-8")
    with pytest.raises(SystemExit, match=r"protocol\.jsonl:2"):
        _load_protocol(path)


def test_unknown_kind_refused(tmp_path: Path) -> None:
    path = _write(tmp_path, [{"turn": 0, "kind": "nudge", "text": "x"}])
    with pytest.raises(SystemExit, match="'kind' must be one of"):
        _load_protocol(path)


def test_duplicate_turn_refused(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        [
            {"turn": 2, "kind": "hint", "text": "a"},
            {"turn": 2, "kind": "hint", "text": "b"},
        ],
    )
    with pytest.raises(SystemExit, match="duplicate injection for turn 2"):
        _load_protocol(path)


def test_negative_turn_reserved_for_proceed(tmp_path: Path) -> None:
    path = _write(tmp_path, [{"turn": -1, "kind": "hint", "text": "x"}])
    with pytest.raises(SystemExit, match="reserved for kind 'proceed'"):
        _load_protocol(path)


def test_empty_text_refused(tmp_path: Path) -> None:
    path = _write(tmp_path, [{"turn": 0, "kind": "hint", "text": "   "}])
    with pytest.raises(SystemExit, match="non-empty string"):
        _load_protocol(path)


def test_bad_turn_value_refused(tmp_path: Path) -> None:
    path = _write(tmp_path, [{"turn": 1.5, "kind": "hint", "text": "x"}])
    with pytest.raises(SystemExit, match="'turn' must be an int"):
        _load_protocol(path)


# -- legacy --proceed-file merge --


def test_merge_appends_standing_approval() -> None:
    merged = _merge_protocol([{"turn": 0, "kind": "hint", "text": "h"}], "continue")
    assert len(merged) == 2
    assert merged[-1] == {
        "turn": -1,
        "kind": "proceed",
        "text": "continue",
        "source": "--proceed-file",
    }


def test_merge_refuses_conflicting_proceed_sources() -> None:
    with pytest.raises(SystemExit, match="conflicting standing-approval"):
        _merge_protocol([{"turn": -1, "kind": "proceed", "text": "p"}], "continue")


# -- deterministic delivery --


def test_injection_selection_is_deterministic() -> None:
    records = [
        {"turn": 3, "kind": "hint", "text": "try 8080"},
        {"turn": 5, "kind": "interference", "text": "panic msg"},
    ]
    scheduled = {r["turn"]: r for r in records}
    assert _injection_for_turn(scheduled, "continue", 1) == "continue"
    assert _injection_for_turn(scheduled, "continue", 3) == "try 8080"
    assert _injection_for_turn(scheduled, "continue", 4) == "continue"
    assert _injection_for_turn(scheduled, "continue", 5) == "panic msg"
    assert _injection_for_turn(scheduled, "continue", 6) == "continue"


def test_counts_cover_every_kind() -> None:
    records = _merge_protocol(
        [
            {"turn": 0, "kind": "hint", "text": "h"},
            {"turn": 1, "kind": "hint", "text": "h2"},
            {"turn": 2, "kind": "interference", "text": "i"},
        ],
        "continue",
    )
    counts = {k: sum(1 for r in records if r["kind"] == k) for k in lab_run.PROTOCOL_KINDS}
    assert counts == {"hint": 2, "interference": 1, "proceed": 1}
