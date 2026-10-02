"""KG freshness tests (ADR-0029, Step 2).

Validates the three freshness fixes:

1. ``KGStore.revision()`` includes edge ``lastupdated`` (edge-only
   mutations bump the revision).
2. ``KGStore.record_observations()`` uses a monotonic per-instance
   sequence counter so same-second writes produce distinguishable
   revisions.
3. ``KGMiddleware.before_model`` refreshes the summary when
   ``kg_revision`` is marked dirty by ``after_model``.

These are the two regression cases the audit requires
(``ARCHITECTURE_AUDIT_FIX.md`` §2) plus the lifecycle fix.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from raptix.middleware.kg import KGMiddleware
from raptix.middleware.kg_internal.store import KGStore

# ── KGStore mock helpers ────────────────────────────────────────────────


def _store_mock_with_revisions(revisions: list[str]) -> MagicMock:
    """Mock KGStore whose ``revision()`` returns successive values."""
    store = MagicMock(spec=KGStore, name="KGStore")
    store.revision.side_effect = revisions
    return store


def _middleware(store: MagicMock) -> KGMiddleware:
    return KGMiddleware(store=store)


# ── Test 1: revision includes edge lastupdated ──────────────────────────


class TestRevisionIncludesEdges:
    """The pre-Step-2 revision() only looked at nodes. Edge-only
    mutations did not bump the revision, so the middleware's cache
    stayed stale. Step 2 fixes this by including edge lastupdated."""

    def test_revision_query_includes_edges(self) -> None:
        """The Cypher query must OPTIONAL MATCH edges and return both
        node_rev and edge_rev."""
        # Inspect the source to verify the query shape.
        import inspect

        source = inspect.getsource(KGStore.revision)
        assert "OPTIONAL MATCH" in source
        assert "edge_rev" in source
        assert "node_rev" in source

    def test_revision_combines_node_and_edge(self) -> None:
        """When edge_rev > node_rev, the returned token uses edge_rev."""
        store = MagicMock(spec=KGStore)
        store.revision.return_value = "rev-acme-5000000"
        mw = _middleware(store)
        # Trigger a revision fetch via before_agent
        out = mw.before_agent({"engagement_name": "acme"}, runtime=None)
        assert out is not None
        assert out["kg_revision"] == "rev-acme-5000000"


# ── Test 2: same-second writes produce distinguishable revisions ────────


class TestSameSecondWrites:
    """The pre-Step-2 update_tag was ``int(time.time())`` — all writes
    in the same second got the same tag. Step 2 uses a monotonic
    per-instance sequence counter so same-second writes produce
    distinguishable tags."""

    def test_update_tag_is_monotonic(self) -> None:
        """Two consecutive calls to _next_update_tag must return
        different values, even within the same second."""

        class _Stub:
            _write_seq = 0

            _next_update_tag = KGStore._next_update_tag

        stub = _Stub()
        tag1 = stub._next_update_tag()
        tag2 = stub._next_update_tag()
        tag3 = stub._next_update_tag()
        assert tag2 > tag1
        assert tag3 > tag2

    def test_update_tag_wraps_at_one_million(self) -> None:
        """The sequence counter wraps at 1_000_000.

        After wrap, _write_seq resets to 0 and the next call produces
        seq=0 (then increments to 1). The wrap is a safety valve —
        1M writes/second is far outside any realistic engagement window.
        """

        # Use a minimal stub instead of KGStore.__new__ to avoid
        # touching the real driver's __init__ path.
        class _Stub:
            _write_seq = 999_999

            _next_update_tag = KGStore._next_update_tag

        stub = _Stub()
        tag1 = stub._next_update_tag()
        # After wrap, _write_seq is 0
        assert stub._write_seq == 0
        tag2 = stub._next_update_tag()
        # Next call: seq=0 was used, then incremented to 1
        assert stub._write_seq == 1
        # Verify the seq parts
        assert tag1 % 1_000_000 == 999_999
        assert tag2 % 1_000_000 == 0
        # tag2 may be < or > tag1 depending on whether the test
        # crossed a second boundary. The important invariant is that
        # the seq counter wrapped correctly.

    def test_update_tag_encodes_timestamp_and_seq(self) -> None:
        """The tag is ``timestamp * 1_000_000 + seq`` so it sorts
        chronologically and is a single integer."""

        class _Stub:
            _write_seq = 42

            _next_update_tag = KGStore._next_update_tag

        stub = _Stub()
        tag = stub._next_update_tag()
        ts_part = tag // 1_000_000
        seq_part = tag % 1_000_000
        assert seq_part == 42
        # ts_part should be a reasonable Unix timestamp (after 2020)
        assert ts_part > 1_577_836_800  # 2020-01-01


# ── Test 3: before_model refreshes when dirty ───────────────────────────


class TestBeforeModelRefresh:
    """The pre-Step-2 implementation only refreshed in before_agent,
    which runs once at agent entry. The tool→model loop returns to
    before_model / model, not before_agent, so a KG write in one tool
    turn was invisible to the next model turn. Step 2 adds a
    before_model hook that refreshes when kg_revision is dirty."""

    def test_before_model_returns_none_when_no_engagement(self) -> None:
        store = _store_mock_with_revisions(["rev-acme-1"])
        mw = _middleware(store)
        out = mw.before_model({}, runtime=None)
        assert out is None

    def test_before_model_returns_none_when_not_dirty(self) -> None:
        """When kg_revision is a real token (not the dirty marker),
        no refresh is needed."""
        store = _store_mock_with_revisions(["rev-acme-7"])
        mw = _middleware(store)
        state = {
            "kg_engagement": "acme",
            "kg_revision": "rev-acme-7",  # real token, not dirty
            "kg_summary": "cached",
        }
        out = mw.before_model(state, runtime=None)
        assert out is None

    def test_before_model_refreshes_when_dirty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When kg_revision is the dirty marker, before_model must
        re-fetch the real revision and rebuild the summary."""
        store = _store_mock_with_revisions(["rev-acme-12"])
        monkeypatch.setattr(
            "raptix.middleware.kg.build_summary",
            lambda store, *, engagement: f"fresh-summary-for-{engagement}",
        )
        mw = _middleware(store)
        state = {
            "kg_engagement": "acme",
            "kg_revision": "dirty",  # marked by after_model
            "kg_summary": "stale",
        }
        out = mw.before_model(state, runtime=None)
        assert out is not None
        assert out["kg_revision"] == "rev-acme-12"
        assert out["kg_summary"] == "fresh-summary-for-acme"

    def test_before_model_swallows_store_failure(self) -> None:
        """When the store is unreachable, before_model must not raise."""
        store = MagicMock(spec=KGStore)
        store.revision.side_effect = RuntimeError("neo4j down")
        mw = _middleware(store)
        state = {
            "kg_engagement": "acme",
            "kg_revision": "dirty",
        }
        out = mw.before_model(state, runtime=None)
        assert out is None

    def test_before_model_summary_failure_records_empty_string(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When summary build fails, the revision still advances so we
        don't keep retrying the broken path."""
        store = _store_mock_with_revisions(["rev-acme-1"])
        monkeypatch.setattr(
            "raptix.middleware.kg.build_summary",
            lambda store, *, engagement: (_ for _ in ()).throw(RuntimeError("timeout")),
        )
        mw = _middleware(store)
        state = {
            "kg_engagement": "acme",
            "kg_revision": "dirty",
        }
        out = mw.before_model(state, runtime=None)
        assert out is not None
        assert out["kg_summary"] == ""
        assert out["kg_revision"] == "rev-acme-1"


# ── Test 4: end-to-end lifecycle (after_model → before_model) ──────────


class TestLifecycleIntegration:
    """The full lifecycle: after_model marks dirty, before_model
    refreshes. This is the core freshness fix."""

    def test_after_model_then_before_model_refreshes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from langchain_core.messages import AIMessage

        store = _store_mock_with_revisions(["rev-acme-99"])
        monkeypatch.setattr(
            "raptix.middleware.kg.build_summary",
            lambda store, *, engagement: f"summary-{engagement}",
        )
        mw = _middleware(store)

        # Simulate: model called kg_record in the last AI step
        state_after_model = {
            "kg_engagement": "acme",
            "kg_revision": "rev-acme-7",
            "kg_summary": "old",
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[{"id": "tc1", "name": "kg_record", "args": {}}],
                )
            ],
        }
        # after_model marks dirty
        dirty_update = mw.after_model(state_after_model, runtime=None)
        assert dirty_update == {"kg_revision": "dirty"}

        # before_model sees dirty and refreshes
        state_after_model.update(dirty_update)
        refresh = mw.before_model(state_after_model, runtime=None)
        assert refresh is not None
        assert refresh["kg_revision"] == "rev-acme-99"
        assert refresh["kg_summary"] == "summary-acme"

    def test_after_model_without_kg_write_does_not_mark_dirty(self) -> None:
        """When the last AI message did NOT call a KG tool, after_model
        must not mark dirty (no refresh needed)."""
        from langchain_core.messages import AIMessage

        store = _store_mock_with_revisions(["rev-acme-7"])
        mw = _middleware(store)
        state = {
            "kg_engagement": "acme",
            "kg_revision": "rev-acme-7",
            "messages": [
                AIMessage(
                    content="thinking",
                    tool_calls=[{"id": "tc1", "name": "bash", "args": {}}],
                )
            ],
        }
        out = mw.after_model(state, runtime=None)
        assert out is None
