"""Fan-out annotations for web surface cells (ADR-0077).

Pins the registry contract that keeps the pre-admission web fan-out rhythm
with the admission gate enabled: read-only classes declare no resource (their
probes never conflict), while mutating classes (authz, ssrf) share exactly one
resource per surface so same-surface siblings serialize and different surfaces
stay independent.
"""

from __future__ import annotations

from raptix.intelligence.agents.standard._surface_registry import (
    build_coverage_matrix,
    build_objective_expand_payload,
)
from raptix.middleware.fanout_admission import (
    RESOURCE_CONFLICT,
    Ceilings,
    EffectClass,
    WorkUnit,
    decide,
)

_ADMIN_SURFACE = {
    "key": "endpoint::GET::/rest/admin",
    "props": {"url": "/rest/admin", "method": "GET"},
}

_SEARCH_SURFACE = {
    "key": "endpoint::GET::/rest/products/search",
    "props": {"url": "/rest/products/search", "method": "GET"},
    "parameters": [{"name": "q"}],
}


def _cells_by_class() -> dict[tuple[str, str], dict]:
    cells = build_coverage_matrix([_ADMIN_SURFACE, _SEARCH_SURFACE])
    return {(cell["vuln_class"], cell["surface_key"]): cell for cell in cells}


def test_mutating_classes_carry_one_resource_per_surface() -> None:
    cells = _cells_by_class()
    authz = cells[("authz", _ADMIN_SURFACE["key"])]
    assert authz["effects"] == EffectClass.MUTATE.value
    assert authz["resources"] == [f"mutate:{_ADMIN_SURFACE['key']}"]
    assert authz["parallel_safe"] is True


def test_readonly_classes_declare_no_resource() -> None:
    cells = _cells_by_class()
    sqli = cells[("sqli", _SEARCH_SURFACE["key"])]
    xss = cells[("xss", _SEARCH_SURFACE["key"])]
    assert sqli["effects"] == EffectClass.READ.value
    assert sqli["resources"] == []
    assert sqli["parallel_safe"] is None
    assert xss["resources"] == []


def _unit(cell: dict, dispatch_id: str) -> WorkUnit:
    return WorkUnit(
        dispatch_id=dispatch_id,
        objective_id=f"OBJ-{dispatch_id}",
        role="surface_exploit",
        effects=EffectClass(cell["effects"]),
        resources=frozenset(cell["resources"]),
        parallel_safe=cell["parallel_safe"],
    )


def test_same_endpoint_mutating_cells_serialize_different_endpoints_overlap() -> None:
    cells = _cells_by_class()
    authz_admin = _unit(cells[("authz", _ADMIN_SURFACE["key"])], "d1")
    authz_admin2 = _unit(cells[("authz", _ADMIN_SURFACE["key"])], "d2")
    authz_other = WorkUnit(
        dispatch_id="d3",
        objective_id="OBJ-3",
        role="surface_exploit",
        effects=EffectClass.MUTATE,
        resources=frozenset({"mutate:endpoint::GET::/rest/other"}),
        parallel_safe=True,
    )

    same = decide(authz_admin2, [authz_admin], ceilings=Ceilings())
    assert not same.admitted
    assert same.code == RESOURCE_CONFLICT

    other = decide(authz_other, [authz_admin], ceilings=Ceilings())
    assert other.admitted


def test_readonly_probes_overlap_on_the_same_surface() -> None:
    cells = _cells_by_class()
    sqli = _unit(cells[("sqli", _SEARCH_SURFACE["key"])], "r1")
    xss = _unit(cells[("xss", _SEARCH_SURFACE["key"])], "r2")
    decision = decide(xss, [sqli], ceilings=Ceilings())
    assert decision.admitted


def test_children_payload_carries_parallel_safe() -> None:
    cells = build_coverage_matrix([_ADMIN_SURFACE])
    children = build_objective_expand_payload("ROOT", cells)
    authz_child = next(
        child
        for child in children["children"]
        if child["title"].startswith("Surface exploit: authz @")
    )
    assert authz_child["parallel_safe"] is True
    assert authz_child["resources"] == [f"mutate:{_ADMIN_SURFACE['key']}"]
