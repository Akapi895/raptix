"""Tests for ``raptix-cli kg reset`` — confirmation gate + scoped delete."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from raptix.cli.kg import main as kg_main
from raptix.knowledge.graph.store import KGStoreConfigError


def _patch_store(deleted: int = 42):
    store = MagicMock()
    store.delete_engagement.return_value = deleted
    return patch("raptix.cli.kg.KGStore.from_env", return_value=store)


def test_reset_refuses_without_yes(capsys: pytest.CaptureFixture[str]) -> None:
    with _patch_store() as mocked:
        rc = kg_main(["reset", "--engagement", "lab-01"])
    assert rc == 2
    mocked.return_value.delete_engagement.assert_not_called()


def test_reset_deletes_only_named_engagement(capsys: pytest.CaptureFixture[str]) -> None:
    with _patch_store(deleted=42) as mocked_factory:
        rc = kg_main(["reset", "--engagement", "lab-01", "--yes"])
    assert rc == 0
    store = mocked_factory.return_value
    store.delete_engagement.assert_called_once_with(engagement="lab-01")
    store.close.assert_called_once()
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload == {"engagement": "lab-01", "deleted": 42}


def test_reset_reports_driver_failure(capsys: pytest.CaptureFixture[str]) -> None:
    with _patch_store() as mocked_factory:
        mocked_factory.return_value.delete_engagement.side_effect = RuntimeError("neo4j down")
        rc = kg_main(["reset", "--engagement", "lab-01", "--yes"])
    assert rc == 1
    assert "KG reset failed" in capsys.readouterr().err


def test_reset_rejects_invalid_label(capsys: pytest.CaptureFixture[str]) -> None:
    with _patch_store() as mocked_factory:
        mocked_factory.return_value.delete_engagement.side_effect = ValueError("bad label")
        rc = kg_main(["reset", "--engagement", "../escape", "--yes"])
    assert rc == 2
    assert "invalid engagement" in capsys.readouterr().err


def test_reset_reports_missing_connection_config(capsys: pytest.CaptureFixture[str]) -> None:
    with patch(
        "raptix.cli.kg.KGStore.from_env",
        side_effect=KGStoreConfigError("RAPTIX_NEO4J_URI not set"),
    ):
        rc = kg_main(["reset", "--engagement", "lab-01", "--yes"])
    assert rc == 2
    assert "not configured" in capsys.readouterr().err
