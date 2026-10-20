"""The Asset Map coverage matrix tracks every registered domain pack, subagent, graph and role.

Registrations come from the installed entry points, the LangGraph registry and the middleware slot
table, not from plugin directory names, so a new registration without a matrix row fails here.
Writers are checked against the repository: a row that names a module must name one that exists,
and a row that writes no catalog asset must say why.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from raptix_core.contracts.slots import SLOTS_PER_ROLE
from raptix_core.types.asset import AssetKind

ROOT = Path(__file__).resolve().parents[2]
MATRIX = ROOT / "docs" / "design" / "2026-10-20-asset-map-coverage-matrix.json"
VERIFICATION_STATES = {"unverified", "partial", "verified-data", "blocked"}
REGISTRATIONS = {"entry-point", "graph-only", "orchestrator", "domain-pack", "library-only"}
# ``decepticon`` is a runtime alias of ``raptix`` (middleware_slots.py), so the core table omits it.
KNOWN_ROLES = set(SLOTS_PER_ROLE) | {"decepticon"}


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


def _graph_ids() -> set[str]:
    return set(json.loads((ROOT / "langgraph.json").read_text(encoding="utf-8"))["graphs"])


def _rows() -> list[dict[str, object]]:
    return json.loads(MATRIX.read_text(encoding="utf-8"))["rows"]


def test_every_registered_domain_pack_has_a_row() -> None:
    covered = {row["domain_pack"] for row in _rows() if row["domain_pack"]}
    assert _registered_domains() <= covered


def test_every_registered_subagent_has_a_row() -> None:
    covered = {row["subagent"] for row in _rows() if row["subagent"]}
    assert _registered_subagents() <= covered


def test_every_langgraph_graph_has_a_row() -> None:
    covered = {graph for row in _rows() for graph in row["graphs"]}
    assert _graph_ids() <= covered


def test_every_middleware_role_has_a_row() -> None:
    covered = {role for row in _rows() for role in row["roles"]}
    assert set(SLOTS_PER_ROLE) <= covered


def test_rows_reference_only_registered_names() -> None:
    for row in _rows():
        if row["domain_pack"]:
            assert row["domain_pack"] in _registered_domains(), row["name"]
        if row["subagent"]:
            assert row["subagent"] in _registered_subagents(), row["name"]
        assert set(row["graphs"]) <= _graph_ids(), row["name"]
        assert set(row["roles"]) <= KNOWN_ROLES, row["name"]


def test_row_names_are_unique() -> None:
    names = [row["name"] for row in _rows()]
    assert len(names) == len(set(names))


def test_verification_states_registrations_and_asset_kinds_are_known() -> None:
    known_kinds = {kind.value for kind in AssetKind}
    for row in _rows():
        assert row["verification"] in VERIFICATION_STATES, row["name"]
        assert row["registration"] in REGISTRATIONS, row["name"]
        assert set(row["asset_kinds"]) <= known_kinds, row["name"]
        assert set(row["catalog_written_kinds"]) <= known_kinds, row["name"]


def test_writers_exist_in_the_repository() -> None:
    for row in _rows():
        for writer in row["writers"]:
            assert (ROOT / writer).is_file(), f"{row['name']}: {writer}"


def test_catalog_written_kinds_have_writers_and_match_their_row() -> None:
    for row in _rows():
        if row["catalog_written_kinds"]:
            assert row["writers"], row["name"]
        assert set(row["catalog_written_kinds"]) <= set(row["asset_kinds"]), row["name"]


def test_rows_that_write_no_catalog_asset_say_why() -> None:
    for row in _rows():
        if not row["catalog_written_kinds"]:
            assert str(row["write_reason"]).strip(), row["name"]


def test_reached_by_names_only_known_roles() -> None:
    for row in _rows():
        assert set(row["reached_by"]) <= KNOWN_ROLES, row["name"]
