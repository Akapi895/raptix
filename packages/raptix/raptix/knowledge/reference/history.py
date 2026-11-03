"""Durable, bounded reference-retrieval metadata; never raw observations."""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from raptix.knowledge.graph.trust import redact_graph_text


def knowledge_home() -> Path:
    root = (
        Path(os.environ["RAPTIX_KNOWLEDGE_STATE_DIR"])
        if os.environ.get("RAPTIX_KNOWLEDGE_STATE_DIR")
        else Path(os.environ.get("RAPTIX_HOME", str(Path.home() / ".raptix"))) / "knowledge"
    )
    root.mkdir(parents=True, exist_ok=True)
    return root


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(knowledge_home() / "retrievals.sqlite", timeout=5)
    db.row_factory = sqlite3.Row
    db.execute(
        "CREATE TABLE IF NOT EXISTS retrievals (id TEXT PRIMARY KEY, created_at TEXT, thread_id TEXT, run_id TEXT, method TEXT, query TEXT, hits INTEGER, status TEXT, items TEXT)"
    )
    try:
        with db:
            yield db
    finally:
        db.close()


def record_retrieval(
    method: str,
    params: dict[str, Any],
    result: dict[str, Any],
    config: dict[str, Any] | None = None,
    *,
    status: str = "success",
) -> None:
    configurable = (config or {}).get("configurable") or {}
    query = redact_graph_text(
        str(params.get("q") or params.get("id") or params.get("key") or method)
    )[:200]
    ids = [str(n.get("id") or n.get("key") or "")[:512] for n in result.get("nodes", [])[:20]]
    with _connect() as db:
        db.execute(
            "INSERT INTO retrievals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                uuid4().hex,
                datetime.now(UTC).isoformat(),
                str(configurable.get("thread_id") or "")[:128],
                str(configurable.get("run_id") or "")[:128],
                method,
                query,
                len(ids),
                status,
                json.dumps(ids),
            ),
        )
        db.execute(
            "DELETE FROM retrievals WHERE id IN (SELECT id FROM retrievals ORDER BY created_at DESC LIMIT -1 OFFSET 10000)"
        )


def retrieval_history(
    *, thread_id: str = "", search: str = "", offset: int = 0, limit: int = 50
) -> dict[str, Any]:
    where = "WHERE (? = '' OR thread_id = ?) AND (? = '' OR instr(lower(query), lower(?)) > 0)"
    args = (thread_id, thread_id, search, search)
    with _connect() as db:
        total = db.execute(f"SELECT count(*) FROM retrievals {where}", args).fetchone()[0]
        rows = db.execute(
            f"SELECT * FROM retrievals {where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
            (*args, limit, offset),
        ).fetchall()
    return {
        "logs": [{**dict(row), "items": json.loads(row["items"])} for row in rows],
        "total": total,
    }


def delete_retrieval(identity: str) -> bool:
    with _connect() as db:
        return db.execute("DELETE FROM retrievals WHERE id = ?", (identity,)).rowcount > 0
