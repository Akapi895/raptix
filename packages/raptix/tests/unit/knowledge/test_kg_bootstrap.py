"""Bootstrap refuses duplicate nodes before any DDL and is a no-op on a rerun (ADR-0094 deployment)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from raptix.knowledge.graph.bootstrap import DuplicateNodesError, bootstrap


class FakeStore:
    """Answers the duplicate scan and the MigrationLog read; records every write."""

    def __init__(self, duplicates: list[dict[str, Any]] | None = None) -> None:
        self.duplicates = duplicates or []
        self.logged: set[str] = set()
        self.writes: list[str] = []

    def execute_read(
        self, cypher: str, params: dict[str, Any] | None = None, *, engagement: str
    ) -> list[dict[str, Any]]:
        if "copies" in cypher:
            return self.duplicates
        if "MigrationLog" in cypher:
            return [{"name": name} for name in sorted(self.logged)]
        return []

    def execute_write(
        self, cypher: str, params: dict[str, Any] | None = None, *, engagement: str
    ) -> None:
        self.writes.append(cypher)
        if "MigrationLog" in cypher and params:
            self.logged.add(params["name"])


@pytest.fixture
def migrations(tmp_path: Path) -> Path:
    (tmp_path / "V001__first.cypher").write_text(
        "CREATE INDEX a IF NOT EXISTS FOR (n:Host) ON (n.key);", encoding="utf-8"
    )
    (tmp_path / "V002__second.cypher").write_text(
        "CREATE INDEX b IF NOT EXISTS FOR (n:Service) ON (n.key);", encoding="utf-8"
    )
    return tmp_path


def test_duplicates_stop_the_bootstrap_before_any_ddl_and_name_the_group(migrations: Path) -> None:
    store = FakeStore(
        [{"label": "Host", "key": "host::10.0.0.1", "engagement": "acme", "copies": 2}]
    )
    with pytest.raises(DuplicateNodesError) as raised:
        bootstrap(store, migrations_dir=migrations)  # type: ignore[arg-type]
    assert "Host key='host::10.0.0.1' engagement='acme' copies=2" in str(raised.value)
    assert store.writes == []
    assert store.logged == set()


def test_first_run_applies_pending_migrations_and_a_rerun_applies_nothing(migrations: Path) -> None:
    store = FakeStore()
    first = bootstrap(store, migrations_dir=migrations)  # type: ignore[arg-type]
    assert first == ["V001__first", "V002__second"]
    writes_after_first = len(store.writes)

    second = bootstrap(store, migrations_dir=migrations)  # type: ignore[arg-type]
    assert second == []
    assert len(store.writes) == writes_after_first
