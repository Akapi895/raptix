from __future__ import annotations

from decepticon.agents.standard._surface_registry import (
    VULN_CLASSES,
    applicable_vuln_classes,
    build_coverage_matrix,
    build_objective_expand_payload,
    session_name_for_cell,
    surfaces_from_kg_inventory,
)
from decepticon_core.contracts.slots import SLOTS_PER_ROLE, MiddlewareSlot


def test_registry_maps_normalized_surface_to_tight_classes() -> None:
    surface = {
        "key": "endpoint::GET::https://app.test/api/users/7?id=7",
        "props": {"path": "/api/users/7", "url": "https://app.test/api/users/7"},
        "parameters": [{"name": "id", "location": "query"}],
    }

    classes = applicable_vuln_classes(surface)

    assert classes == ("sqli", "idor", "authz")
    assert "graphql" not in classes


def test_registry_builds_deterministic_unique_sessions() -> None:
    surfaces = [
        {
            "key": "endpoint::GET::https://app.test/search",
            "props": {"path": "/search"},
            "parameters": [{"name": "q"}],
        },
        {
            "key": "endpoint::POST::https://app.test/graphql",
            "props": {"path": "/graphql", "protocol": "graphql"},
        },
    ]

    first = build_coverage_matrix(surfaces)
    second = build_coverage_matrix(surfaces)

    assert first == second
    assert len({cell["session"] for cell in first}) == len(first)
    assert all(cell["session"] == session_name_for_cell(cell["cell_id"]) for cell in first)
    assert {cell["vuln_class"] for cell in first} >= {"sqli", "xss", "graphql"}


def test_surface_exploit_role_has_kg_and_autoingest() -> None:
    slots = SLOTS_PER_ROLE["surface_exploit"]

    assert MiddlewareSlot.KG in slots
    assert MiddlewareSlot.KG_AUTOINGEST in slots
    assert set(VULN_CLASSES) == {
        "sqli",
        "xss",
        "idor",
        "ssrf",
        "authn_jwt",
        "authz",
        "ssti",
        "xxe",
        "open_redirect",
        "graphql",
    }


def test_kg_inventory_and_objective_payload_are_deterministic() -> None:
    rows = [
        {
            "key": "endpoint::GET::https://app.test/search",
            "props_json": '{"url":"https://app.test/search","path":"/search"}',
            "children": [
                {
                    "kind": "Parameter",
                    "key": "parameter::q",
                    "label": "q",
                    "props_json": '{"name":"q","location":"query"}',
                }
            ],
        }
    ]

    surfaces = surfaces_from_kg_inventory(rows)
    cells = build_coverage_matrix(surfaces)
    payload = build_objective_expand_payload("OBJ-001", cells)

    assert [cell["cell_id"] for cell in cells] == [
        "sqli::endpoint::GET::https://app.test/search",
        "xss::endpoint::GET::https://app.test/search",
    ]
    assert payload["parent_id"] == "OBJ-001"
    assert all(child["owner"] == "surface_exploit" for child in payload["children"])
    assert all(child["mitre"] == ["T1190"] for child in payload["children"])
    assert all("session_name=" in child["notes"] for child in payload["children"])
