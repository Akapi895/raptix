"""Unit tests for :mod:`kg_internal.operational_state` — driver-free.

Covers section rendering, empty-graph behavior (returns "" so the
injection layer drops the block), engagement scoping of every query,
and the shadow-block header. Live-Neo4j coverage can follow the
``test_kg_summary_live.py`` pattern once a seeded fixture exists.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from raptix.middleware.kg_internal.operational_state import (
    BLOCK_HEADER,
    MAX_ACCESS_ROWS,
    MAX_CREDENTIAL_ROWS,
    MAX_REACH_ROWS,
    _render_access,
    _render_credentials,
    _render_reachability,
    build_operational_state,
)
from raptix.middleware.kg_internal.store import KGStore

# ── Section renderers ──────────────────────────────────────────────────


def test_render_access_includes_props() -> None:
    out = _render_access(
        [
            {
                "source_asset": "WS01",
                "principal": "jdoe",
                "logon_type": 10,
                "privileged": True,
                "session_source": "registry",
            }
        ]
    )
    assert "Access (recorded sessions)" in out
    assert "jdoe @ WS01" in out
    assert "logon_type=10" in out
    assert "privileged" in out
    assert "source=registry" in out


def test_render_access_omits_missing_props() -> None:
    out = _render_access([{"source_asset": "WS01", "principal": "jdoe", "privileged": False}])
    # Row renders bare — no parenthesised suffix when nothing is known.
    assert out.splitlines()[1] == "- jdoe @ WS01"


def test_render_access_zero_logon_type_not_dropped() -> None:
    """logon_type=0 is a valid SharpHound value — must survive the
    falsy-value traps (no bare ``or ""`` coercion)."""
    out = _render_access([{"source_asset": "WS01", "principal": "svc", "logon_type": 0}])
    assert "logon_type=0" in out


def test_render_credentials_full_row() -> None:
    out = _render_credentials(
        [
            {
                "label": "CORP\\jdoe",
                "protocol": "ntlm",
                "target": "WS01",
                "secret_type": "ntlm",
                "source": "crackmapexec",
                "admin": True,
                "principals": ["CORP\\jdoe"],
            }
        ]
    )
    assert "Credentials" in out
    assert "`CORP\\jdoe`" in out
    assert "protocol=ntlm" in out
    assert "target=WS01" in out
    assert "secret_type=ntlm" in out
    assert "source=crackmapexec" in out
    assert ", admin)" in out
    assert "→ CORP\\jdoe" in out


def test_render_credentials_falls_back_when_label_missing() -> None:
    out = _render_credentials([{"principals": []}])
    assert "- `?`" in out
    # No suffix, no principal arrow.
    assert "(" not in out
    assert "→" not in out


def test_render_credentials_caps_principals() -> None:
    out = _render_credentials([{"label": "c1", "principals": ["u1", "u2", "u3", "u4", "u5"]}])
    assert "u3" in out
    assert "u4" not in out


def test_render_reachability_lists_edges() -> None:
    out = _render_reachability(
        [
            {"principal": "jdoe", "target": "WS02", "edge_kind": "CAN_ACCESS"},
            {"principal": "adm", "target": "DC01", "edge_kind": "ADMIN_TO"},
        ]
    )
    assert "Reachability (direct access edges)" in out
    assert "- adm -[ADMIN_TO]-> DC01" in out
    assert "- jdoe -[CAN_ACCESS]-> WS02" in out


# ── Stub store plumbing ────────────────────────────────────────────────


class _StubStore:
    """Minimal stub matching the KGStore surface the projection uses."""

    def __init__(self, responses: dict[str, list[dict[str, Any]]]) -> None:
        self._responses = responses
        self.calls: list[tuple[str, dict[str, Any] | None, str]] = []

    def execute_read(
        self,
        cypher: str,
        params: dict[str, Any] | None = None,
        *,
        engagement: str,
    ) -> list[dict[str, Any]]:
        self.calls.append((cypher, params, engagement))
        # Coarse routing via signature substrings in the Cypher — the
        # scope predicates are implementation details this stub must not
        # pin beyond asserting $engagement appears.
        if ":HAS_SESSION]" in cypher:
            return self._responses.get("access", [])
        if "(c:Credential)" in cypher:
            return self._responses.get("credentials", [])
        if ":CAN_ACCESS|ADMIN_TO]" in cypher:
            return self._responses.get("reachability", [])
        return []


# ── build_operational_state integration with stubbed store ────────────


def test_build_operational_state_empty_graph_returns_empty_string() -> None:
    """No rows anywhere → "" → the caller injects nothing."""
    store = _StubStore({})
    assert build_operational_state(store, engagement="acme") == ""


def test_build_operational_state_scopes_every_query_to_engagement() -> None:
    store = _StubStore({})
    build_operational_state(store, engagement="acme")
    assert len(store.calls) == 3
    for cypher, params, engagement in store.calls:
        assert "$engagement" in cypher
        assert params is not None and params["engagement"] == "acme"
        assert engagement == "acme"


def test_build_operational_state_full_engagement() -> None:
    store = _StubStore(
        {
            "access": [
                {
                    "source_asset": "WS01",
                    "principal": "jdoe",
                    "logon_type": 10,
                    "privileged": True,
                    "session_source": "",
                }
            ],
            "credentials": [
                {
                    "label": "CORP\\jdoe",
                    "protocol": "ntlm",
                    "target": "WS01",
                    "secret_type": "ntlm",
                    "source": "crackmapexec",
                    "admin": True,
                    "principals": ["CORP\\jdoe"],
                }
            ],
            "reachability": [{"principal": "jdoe", "target": "WS02", "edge_kind": "CAN_ACCESS"}],
        }
    )
    out = build_operational_state(store, engagement="acme")
    assert out.startswith(BLOCK_HEADER)
    assert "jdoe @ WS01" in out
    assert "`CORP\\jdoe`" in out
    assert "- jdoe -[CAN_ACCESS]-> WS02" in out
    # Section order: access → credentials → reachability.
    assert (
        out.find("Access (recorded sessions)") < out.find("Credentials") < out.find("Reachability")
    )


def test_build_operational_state_drops_empty_sections() -> None:
    store = _StubStore({"credentials": [{"label": "CORP\\jdoe", "principals": []}]})
    out = build_operational_state(store, engagement="acme")
    assert "Credentials" in out
    assert "Access (recorded sessions)" not in out
    assert "Reachability" not in out


def test_build_operational_state_returns_empty_for_mock_store() -> None:
    """A bare MagicMock store must yield "" — not a header-only block.

    Guards the defensive ``list()`` conversion: MagicMock rows are
    truthy but iterate empty, and a header-only block would leak into
    every middleware unit test that passes an unconfigured store mock.
    """
    store = MagicMock(spec=KGStore)
    assert build_operational_state(store, engagement="acme") == ""


def test_max_constants_are_small() -> None:
    """Sanity guard: budgets stay tight (memory-systems anti-pattern)."""
    assert MAX_ACCESS_ROWS <= 10
    assert MAX_CREDENTIAL_ROWS <= 25
    assert MAX_REACH_ROWS <= 25
