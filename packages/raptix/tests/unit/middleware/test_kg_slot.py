"""Role wiring of the KG middleware slot factory (Wave T4).

``_make_kg`` decides per role how heavy a ``KGMiddleware`` to build.
The Wave T4 addition under test: the orchestrator role (``raptix``)
gets the planning-context projection (cheapest known attack paths)
injected automatically; specialist roles do not. Pinned via a
recording stand-in so no Neo4j connection is needed.
"""

from __future__ import annotations

import pytest


class _RecordingKG:
    instances: list[dict] = []

    def __init__(self, **kwargs) -> None:
        _RecordingKG.instances.append(kwargs)


@pytest.fixture(autouse=True)
def _clear_instances() -> None:
    _RecordingKG.instances.clear()


def _make_kg_with_recorder(monkeypatch: pytest.MonkeyPatch):
    from raptix.intelligence.agents import middleware_slots

    monkeypatch.setattr(middleware_slots, "KGMiddleware", _RecordingKG)
    return middleware_slots._make_kg


def test_orchestrator_role_gets_planning_context(monkeypatch: pytest.MonkeyPatch) -> None:
    make_kg = _make_kg_with_recorder(monkeypatch)
    make_kg(role="raptix")
    assert _RecordingKG.instances == [
        {
            "enabled_tools": {
                "kg_surface_inventory",
                "challenge_inventory",
                "kg_query",
                "kg_query_reference",
            },
            "operational_shadow": False,
            "planning_context": True,
        }
    ]


def test_specialist_roles_have_no_planning_context(monkeypatch: pytest.MonkeyPatch) -> None:
    """``recon`` has no planning context, but does get bounded read+write KG
    tools (Mục 4 role grant: recon/exploit keep write, postexploit is
    read-only) — ``enabled_tools`` is no longer ``None`` for this role."""
    make_kg = _make_kg_with_recorder(monkeypatch)
    make_kg(role="recon")
    assert _RecordingKG.instances[0]["planning_context"] is False
    assert _RecordingKG.instances[0]["enabled_tools"] == {
        "kg_query",
        "kg_query_reference",
        "kg_surface_inventory",
        "kg_record",
        "kg_ingest",
    }


def test_unlisted_role_keeps_no_enabled_tools_restriction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A role outside {raptix, recon, exploit, postexploit} gets the
    unrestricted default (``enabled_tools=None``) — the read-only grant is
    scoped to exactly those roles, not opened to every specialist."""
    make_kg = _make_kg_with_recorder(monkeypatch)
    make_kg(role="ad_operator")
    assert _RecordingKG.instances[0]["enabled_tools"] is None


def test_operational_shadow_needs_both_role_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    make_kg = _make_kg_with_recorder(monkeypatch)
    monkeypatch.setenv("RAPTIX_KG_OPERATIONAL_SHADOW", "1")
    make_kg(role="recon")
    make_kg(role="raptix")
    assert _RecordingKG.instances[0]["operational_shadow"] is False
    assert _RecordingKG.instances[1]["operational_shadow"] is True


def test_missing_neo4j_env_degrades_to_absent_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without Neo4j env vars the slot returns None — the agent still boots."""
    from raptix.intelligence.agents.middleware_slots import _make_kg

    for var in ("RAPTIX_NEO4J_URI", "RAPTIX_NEO4J_USER", "RAPTIX_NEO4J_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    assert _make_kg(role="recon") is None
