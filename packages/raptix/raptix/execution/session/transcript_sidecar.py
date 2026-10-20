"""Durable sidecar for sub-agent transcripts (checkpoint state slimming, option E).

A sub-agent's events used to travel back to the orchestrator as the ``subagent_transcripts`` state channel, so every
checkpoint copied the whole transcript. The events now go here instead: one append-only row per event, keyed by thread
and a per-thread sequence number. The graph state no longer carries them, so checkpoints stay small.

The sidecar is observability, not model input. The model reads ``messages`` from state; nothing reads these rows to
decide anything. A replay or fork from an older checkpoint still sees every event recorded on the thread, including
events from a branch that was abandoned. Callers must present them as "all events of this thread".
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PATH_ENV = "RAPTIX_TRANSCRIPT_SIDECAR_PATH"
DEFAULT_PATH = ".langgraph_api/transcripts.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS transcript_events (
    thread_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, seq)
);
"""


class TranscriptSidecar:
    """SQLite-backed, append-only event log per thread. One lock serializes writes from concurrent sub-agents."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(target), check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._lock = threading.Lock()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def append(self, thread_id: str, events: list[dict[str, Any]]) -> None:
        """Append events in order. The sequence continues from the thread's highest recorded number."""
        if not events:
            return
        now = datetime.now(UTC).isoformat()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                (start,) = self._conn.execute(
                    "SELECT COALESCE(MAX(seq), 0) FROM transcript_events WHERE thread_id = ?",
                    (thread_id,),
                ).fetchone()
                self._conn.executemany(
                    "INSERT INTO transcript_events (thread_id, seq, event_json, created_at) VALUES (?, ?, ?, ?)",
                    [
                        (
                            thread_id,
                            start + offset,
                            json.dumps(event, default=str, ensure_ascii=False),
                            now,
                        )
                        for offset, event in enumerate(events, start=1)
                    ],
                )
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise

    def page(
        self, thread_id: str, before: int | None, limit: int
    ) -> list[tuple[int, dict[str, Any]]]:
        """The newest ``limit`` events with ``seq < before`` (all newest when ``before`` is None), oldest first."""
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT seq, event_json FROM transcript_events
                WHERE thread_id = ? AND (? IS NULL OR seq < ?)
                ORDER BY seq DESC LIMIT ?
                """,
                (thread_id, before, before, limit),
            ).fetchall()
        return [(seq, json.loads(payload)) for seq, payload in reversed(rows)]


_default: TranscriptSidecar | None = None
_default_lock = threading.Lock()


def default_sidecar() -> TranscriptSidecar:
    """The process-wide sidecar, opened once at the path from ``RAPTIX_TRANSCRIPT_SIDECAR_PATH`` (or the default)."""
    global _default
    with _default_lock:
        if _default is None:
            _default = TranscriptSidecar(os.environ.get(PATH_ENV, DEFAULT_PATH))
        return _default


class DurableTranscript(list):
    """A sub-agent's transcript list that writes every event to the sidecar as it is appended.

    The streaming code appends to it exactly as it did to a plain list, so the event content and order do not change.
    Without a thread id (the sub-agent was started outside a thread) it stays an in-memory list and nothing is written.
    """

    def __init__(self, thread_id: str | None) -> None:
        super().__init__()
        self._thread_id = thread_id

    @classmethod
    def for_current_thread(cls) -> DurableTranscript:
        from langgraph.config import get_config  # noqa: PLC0415

        try:
            thread_id = (get_config().get("configurable") or {}).get("thread_id")
        except RuntimeError:
            thread_id = None
        return cls(thread_id if isinstance(thread_id, str) and thread_id else None)

    def append(self, event: Any) -> None:
        super().append(event)
        if self._thread_id is not None:
            default_sidecar().append(self._thread_id, [event])
