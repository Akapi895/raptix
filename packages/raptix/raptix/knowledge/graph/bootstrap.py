"""Explicit KG schema bootstrap: duplicate preflight, then the project's migration runner.

Run once per deployment and again after an upgrade::

    python -m raptix.knowledge.graph.bootstrap

A rerun applies nothing. Duplicate ``(key, engagement)`` nodes stop the bootstrap before any
DDL: a uniqueness constraint cannot be created over them, and this step never merges data.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from raptix.knowledge.graph.migration_runner import _MIGRATION_ENGAGEMENT, apply_migrations
from raptix.knowledge.graph.store import KGStore

MAX_REPORTED_DUPLICATES = 20

# Grouped the way the uniqueness constraints are keyed: first label, key, engagement.
DUPLICATE_NODES = (
    "MATCH (n) WHERE n.key IS NOT NULL AND n.engagement IS NOT NULL "
    "WITH head(labels(n)) AS label, n.key AS key, n.engagement AS engagement, count(*) AS copies "
    "WHERE copies > 1 "
    "RETURN label, key, engagement, copies ORDER BY copies DESC LIMIT $limit"
)


class DuplicateNodesError(RuntimeError):
    """Nodes that would violate a uniqueness constraint; carries the rows for the operator."""

    def __init__(self, duplicates: list[dict[str, Any]]) -> None:
        self.duplicates = duplicates
        listing = "; ".join(
            f"{row['label']} key={row['key']!r} engagement={row['engagement']!r} copies={row['copies']}"
            for row in duplicates
        )
        super().__init__(
            f"{len(duplicates)} duplicate group(s) block the KG constraints (first {MAX_REPORTED_DUPLICATES} listed): {listing}. "
            "Resolve them in the graph, then rerun the bootstrap. Nothing was merged or applied."
        )


def bootstrap(store: KGStore, *, migrations_dir: Path | None = None) -> list[str]:
    """Refuse on duplicates, otherwise apply pending migrations. Returns the names applied now."""
    duplicates = store.execute_read(
        DUPLICATE_NODES,
        {"limit": MAX_REPORTED_DUPLICATES},
        engagement=_MIGRATION_ENGAGEMENT,
    )
    if duplicates:
        raise DuplicateNodesError(duplicates)
    return apply_migrations(store, migrations_dir=migrations_dir)


def main() -> int:
    store = KGStore.from_env()
    try:
        applied = bootstrap(store)
    except DuplicateNodesError as exc:
        print(f"kg-bootstrap: refused: {exc}", file=sys.stderr)
        return 2
    finally:
        store.close()
    print(
        f"kg-bootstrap: applied {len(applied)} migration(s): {', '.join(applied) or 'none (already current)'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
