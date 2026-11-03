from __future__ import annotations

from raptix.intelligence.agents.standard._surface_registry import (
    VULN_CLASSES,
    applicable_vuln_classes,
    build_coverage_matrix,
    build_objective_expand_payload,
    independent_cell_count,
    recommended_in_flight,
    server_resilience_cap,
    session_name_for_cell,
    surfaces_from_kg_inventory,
)
from raptix_core.contracts.slots import SLOTS_PER_ROLE, MiddlewareSlot


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

    search_sessions = {
        cell["session_name"] for cell in first if cell["surface_key"].endswith("/search")
    }
    assert search_sessions == {
        session_name_for_cell("sqli::endpoint::GET::https://app.test/search"),
        session_name_for_cell("xss::endpoint::GET::https://app.test/search"),
    }


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
    assert {cell["gen"] for cell in cells} == {0}
    assert payload["parent_id"] == "OBJ-001"
    assert all(child["owner"] == "surface_exploit" for child in payload["children"])
    assert all(child["mitre"] == ["T1190"] for child in payload["children"])
    assert all("session_name=" in child["notes"] for child in payload["children"])
    assert all("gen=0" in child["notes"] for child in payload["children"])


def test_independent_cell_count_excludes_chain_dependent_cells() -> None:
    cells = [
        {"cell_id": "sqli::a", "via_cell": ""},
        {"cell_id": "xss::a"},
        {"cell_id": "ssrf::b", "via_cell": "sqli::a"},
    ]

    assert independent_cell_count(cells) == 2


def test_server_resilience_cap_defaults_to_three_for_unmatched_technology() -> None:
    surfaces = [{"key": "s1", "technologies": [{"label": "nginx"}]}]

    assert server_resilience_cap(surfaces) == 3
    assert server_resilience_cap([]) == 3


def test_server_resilience_cap_drops_to_one_for_known_fragile_technology() -> None:
    surfaces = [
        {"key": "s1", "technologies": [{"label": "nginx"}]},
        {"key": "s2", "technologies": [{"label": "Werkzeug/3.0"}]},
    ]

    assert server_resilience_cap(surfaces) == 1


def test_recommended_in_flight_combines_independence_and_resilience() -> None:
    independent_cells = [{"cell_id": f"sqli::{i}"} for i in range(5)]
    resilient_surfaces = [{"key": "s1", "technologies": [{"label": "nginx"}]}]
    fragile_surfaces = [{"key": "s1", "technologies": [{"label": "werkzeug"}]}]

    assert recommended_in_flight(independent_cells, resilient_surfaces) == 3
    assert recommended_in_flight(independent_cells, fragile_surfaces) == 1

    one_independent = [{"cell_id": "sqli::a"}, {"cell_id": "ssrf::b", "via_cell": "sqli::a"}]
    assert recommended_in_flight(one_independent, resilient_surfaces) == 1
