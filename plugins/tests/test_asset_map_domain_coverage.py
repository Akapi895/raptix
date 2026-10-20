"""The Asset Map coverage matrix tracks every registered domain pack and subagent.

Registrations come from the installed entry points, not from the plugin directory
names, so a new registration without a matrix row fails here.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from raptix_core.types.asset import AssetKind

ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "docs" / "design" / "2026-10-20-asset-map-coverage-matrix.json"
VERIFICATION_STATES = {"unverified", "partial", "verified-data", "blocked"}


def _entry_points(pyproject: Path, group: str) -> dict[str, str]:
    data = tomllib.loads(pyproject.read_text(encoding="utf-8"))
    return dict(data.get("project", {}).get("entry-points", {}).get(group, {}))


def _registered_domains() -> set[str]:
    names: set[str] = set()
    for pyproject in (ROOT / "plugins").glob("*/pyproject.toml"):
        names.update(_entry_points(pyproject, "raptix.domains"))
    return names


def _registered_subagents() -> set[str]:
    names = set(_entry_points(ROOT / "packages" / "raptix" / "pyproject.toml", "raptix.subagents"))
    for pyproject in (ROOT / "plugins").glob("*/pyproject.toml"):
        names.update(_entry_points(pyproject, "raptix.subagents"))
    return names


def _rows() -> list[dict[str, object]]:
    return json.loads(MATRIX.read_text(encoding="utf-8"))["rows"]


def test_every_registered_domain_pack_has_a_row() -> None:
    covered = {row["domain_pack"] for row in _rows() if row["domain_pack"]}
    assert _registered_domains() <= covered


def test_every_registered_subagent_has_a_row() -> None:
    covered = {row["subagent"] for row in _rows() if row["subagent"]}
    assert _registered_subagents() <= covered


def test_rows_reference_only_registered_names() -> None:
    for row in _rows():
        if row["domain_pack"]:
            assert row["domain_pack"] in _registered_domains(), row["name"]
        if row["subagent"]:
            assert row["subagent"] in _registered_subagents(), row["name"]


def test_row_names_are_unique() -> None:
    names = [row["name"] for row in _rows()]
    assert len(names) == len(set(names))


def test_verification_states_and_asset_kinds_are_known() -> None:
    known_kinds = {kind.value for kind in AssetKind}
    for row in _rows():
        assert row["verification"] in VERIFICATION_STATES, row["name"]
        assert set(row["asset_kinds"]) <= known_kinds, row["name"]
