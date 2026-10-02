"""KG decision freshness across independent writers and same-second updates."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from raptix.middleware.kg import KGMiddleware
from raptix.middleware.kg_internal.store import KGStore, KGStoreConfig


def test_before_model_detects_external_write_without_local_dirty_marker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = MagicMock(spec=KGStore)
    store.revision.side_effect = ["rev-lab-1:100:100", "rev-lab-2:100:100"]
    monkeypatch.setattr("raptix.middleware.kg.build_summary", lambda store, *, engagement: "fresh")
    middleware = KGMiddleware(store=store)
    initial = middleware.before_agent({"engagement_name": "lab"}, None)
    assert initial is not None
    assert initial["kg_revision"] == "rev-lab-1:100:100"
    updated = middleware.before_model({"kg_engagement": "lab", **initial}, None)
    assert updated is not None
    assert updated["kg_revision"] == "rev-lab-2:100:100"
    assert updated["kg_summary"] == "fresh"


def test_multiwriter_revision_uses_atomic_counter_even_when_timestamps_do_not_advance() -> None:
    driver = MagicMock()
    session = driver.session.return_value.__enter__.return_value
    session.execute_read.side_effect = [
        [{"seq": 7, "node_rev": 100, "edge_rev": 100}],
        [{"seq": 8, "node_rev": 100, "edge_rev": 100}],
    ]
    store = KGStore(
        KGStoreConfig(uri="bolt://localhost:7687", user="u", password="p"), driver=driver
    )
    prior = store.revision(engagement="lab")
    after = store.revision(engagement="lab")
    assert prior != after
    assert after == "rev-lab-8:100:100"
    query = session.execute_read.call_args_list[0].args[0]
    tx = MagicMock()
    tx.run.return_value = [{"seq": 7, "node_rev": 100, "edge_rev": 100}]
    query(tx)
    cypher = tx.run.call_args.args[0]
    assert "KGRevision" in cypher
    assert "max(r.lastupdated)" in cypher
    assert "CALL () {" in cypher  # independent subqueries, no node × edge join


def test_clean_revision_does_not_rebuild_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    store = MagicMock(spec=KGStore)
    store.revision.return_value = "rev-lab-8:100:100"
    rebuild = MagicMock()
    monkeypatch.setattr("raptix.middleware.kg.build_summary", rebuild)
    result = KGMiddleware(store=store).before_model(
        {
            "kg_engagement": "lab",
            "kg_revision": "rev-lab-8:100:100",
            "kg_summary": "unchanged",
        },
        None,
    )
    assert result is None
    rebuild.assert_not_called()
