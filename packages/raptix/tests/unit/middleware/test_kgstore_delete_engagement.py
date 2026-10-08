"""Unit tests for :meth:`KGStore.delete_engagement` — the scoped reset.

The invariant under test: a reset of engagement A deletes only nodes
whose engagement label is A. Other engagements' nodes are untouched by
construction (the Cypher filters on the label) — the tests pin the
Cypher shape, the bounded-sweep loop, and label validation.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from raptix.knowledge.graph.store import KGStore, KGStoreConfig

# -- fake driver (mirrors test_kgstore_unit.py) --


def _fake_driver(rows_per_sweep: list[list[dict[str, Any]]]) -> MagicMock:
    """Session whose execute_write pops one response per sweep."""
    driver = MagicMock(name="Driver")
    session = MagicMock(name="Session")
    responses = iter(rows_per_sweep)

    def _execute_write(_tx_fn):
        try:
            return next(responses)
        except StopIteration:  # extra sweeps: graph drained
            return [{"deleted": 0}]

    session.execute_write.side_effect = _execute_write
    driver.session.return_value.__enter__.return_value = session
    driver.session.return_value.__exit__.return_value = None
    return driver


def _store(driver: MagicMock) -> KGStore:
    cfg = KGStoreConfig(
        uri="bolt://neo4j:7687",
        user="neo4j",
        password="secret",
        database="neo4j",
    )
    return KGStore(cfg, driver=driver)


def _session(driver: MagicMock) -> MagicMock:
    return driver.session.return_value.__enter__.return_value


# -- happy paths --


def test_delete_engagement_returns_total_across_sweeps() -> None:
    # First sweep hits the 1000 LIMIT, second drains the rest.
    driver = _fake_driver([[{"deleted": 1000}], [{"deleted": 412}]])
    store = _store(driver)
    total = store.delete_engagement(engagement="lab-01")
    assert total == 1412
    assert store  # keep linters quiet about the fixture shape


def test_delete_engagement_single_sweep_when_under_limit() -> None:
    driver = _fake_driver([[{"deleted": 7}]])
    store = _store(driver)
    assert store.delete_engagement(engagement="lab-01") == 7
    assert _session(driver).execute_write.call_count == 1


def test_delete_engagement_empty_slice_is_zero() -> None:
    driver = _fake_driver([[{"deleted": 0}]])
    store = _store(driver)
    assert store.delete_engagement(engagement="lab-01") == 0


# -- scoping contract (the actual isolation guarantee) --


def test_delete_cypher_is_engagement_scoped() -> None:
    driver = _fake_driver([[{"deleted": 0}]])
    store = _store(driver)
    store.delete_engagement(engagement="lab-01")
    call = _session(driver).execute_write.call_args
    tx_fn = call.args[0]
    # Cypher is embedded in the tx lambda; re-run it against a fake tx to
    # capture the query + params the driver would receive.
    tx = MagicMock()
    tx.run.return_value = [MagicMock()]
    tx_fn(tx)
    cypher = tx.run.call_args.args[0]
    params = tx.run.call_args.kwargs
    assert "n.engagement = $engagement" in cypher
    assert "DETACH DELETE n" in cypher
    assert params["engagement"] == "lab-01"
    # Every matched node is scoped to the engagement label — no bare
    # MATCH (n) DETACH DELETE (graph-wide wipe) may ever ship here.
    assert "WITH n LIMIT 1000" in cypher


def test_delete_rejects_invalid_engagement_label() -> None:
    driver = _fake_driver([])
    store = _store(driver)
    with pytest.raises(ValueError, match="non-empty engagement label"):
        store.delete_engagement(engagement="")
    with pytest.raises(ValueError, match="invalid engagement label"):
        store.delete_engagement(engagement="../escape")
    _session(driver).execute_write.assert_not_called()


def test_delete_sweeps_until_drained_loop_guard() -> None:
    # A pathological graph: three full sweeps then a short one. The loop
    # must terminate on the first sub-limit sweep, not run forever.
    driver = _fake_driver(
        [[{"deleted": 1000}], [{"deleted": 1000}], [{"deleted": 1000}], [{"deleted": 1}]]
    )
    store = _store(driver)
    assert store.delete_engagement(engagement="lab-01") == 3001
    assert _session(driver).execute_write.call_count == 4
