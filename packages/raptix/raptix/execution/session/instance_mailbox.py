"""Durable mailbox for running dispatch instances (plan P10c).

An operator message to a running instance moves through four durable states:

- ``accepted``: enqueued durably; the recipient has not seen it yet.
- ``delivered``: the recipient's model turn consumed it at its safe point. Never offered twice.
- ``handled``: the model turn that received it completed.
- ``undelivered``: the instance ended before its next safe point.

``accepted`` is only a durable enqueue; it is not a delivery. A message is deduplicated by its
client-supplied id, so a retried request never creates a second message. A process restart never
re-offers a delivered message. Instances still marked running when a process starts are
``interrupted``: no process can still be running them, so they accept no further messages.
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

PATH_ENV = "RAPTIX_INSTANCE_MAILBOX_PATH"
DEFAULT_PATH = ".langgraph_api/instance_mailbox.sqlite"
MAX_BODY_CHARS = 2000
MAX_PENDING = 8

ACCEPTED = "accepted"
DELIVERED = "delivered"
HANDLED = "handled"
UNDELIVERED = "undelivered"

RUNNING = "running"
FINISHED = "finished"
INTERRUPTED = "interrupted"

_MESSAGE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,95}\Z")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS instances (
    thread_id TEXT NOT NULL,
    dispatch_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    role TEXT,
    state TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT,
    PRIMARY KEY (thread_id, dispatch_id, attempt)
);
CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    dispatch_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    delivered_at TEXT,
    handled_at TEXT,
    outcome TEXT,
    UNIQUE (thread_id, dispatch_id, attempt, seq)
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass(frozen=True)
class MailboxMessage:
    message_id: str
    thread_id: str
    dispatch_id: str
    attempt: int
    seq: int
    body: str
    state: str
    accepted_at: str
    delivered_at: str | None
    handled_at: str | None
    outcome: str | None


@dataclass(frozen=True)
class InstanceRow:
    thread_id: str
    dispatch_id: str
    attempt: int
    role: str | None
    state: str
    started_at: str
    finished_at: str | None


@dataclass(frozen=True)
class AcceptResult:
    """``status`` is ``accepted``, ``duplicate`` (same id already recorded) or ``refused``."""

    status: str
    reason: str | None
    message: MailboxMessage | None
    attempt: int | None


class InstanceMailbox:
    def __init__(self, path: str | os.PathLike[str], *, clock: Callable[[], str] = _now) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(target), check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.executescript(_SCHEMA)
        self._conn.execute(
            "UPDATE instances SET state = ?, finished_at = ? WHERE state = ?",
            (INTERRUPTED, self._clock(), RUNNING),
        )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ── instance lifecycle ──────────────────────────────────────────────

    def start_instance(
        self, thread_id: str, dispatch_id: str, attempt: int, role: str | None
    ) -> None:
        now = self._clock()
        with self._lock:
            self._conn.execute(
                "INSERT INTO instances (thread_id, dispatch_id, attempt, role, state, started_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (thread_id, dispatch_id, attempt) DO NOTHING",
                (thread_id, dispatch_id, attempt, role, RUNNING, now, now),
            )

    def finish_instance(self, thread_id: str, dispatch_id: str, attempt: int) -> None:
        now = self._clock()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute(
                    "UPDATE instances SET state = ?, finished_at = ?, updated_at = ?"
                    " WHERE thread_id = ? AND dispatch_id = ? AND attempt = ? AND state = ?",
                    (FINISHED, now, now, thread_id, dispatch_id, attempt, RUNNING),
                )
                self._conn.execute(
                    "UPDATE messages SET state = ?, outcome = ? WHERE thread_id = ? AND dispatch_id = ?"
                    " AND attempt = ? AND state = ?",
                    (UNDELIVERED, "instance_finished", thread_id, dispatch_id, attempt, ACCEPTED),
                )
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    # ── operator side ───────────────────────────────────────────────────

    def accept(self, message_id: str, thread_id: str, dispatch_id: str, body: str) -> AcceptResult:
        """Durably enqueue one message for the instance's running attempt."""
        if not _MESSAGE_ID.fullmatch(message_id):
            return AcceptResult("refused", "invalid_message_id", None, None)
        text = body.strip()
        if not text:
            return AcceptResult("refused", "empty_message", None, None)
        if len(text) > MAX_BODY_CHARS:
            return AcceptResult("refused", "message_too_large", None, None)
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                result = self._accept_locked(message_id, thread_id, dispatch_id, text)
                self._conn.execute("COMMIT")
                return result
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def _accept_locked(
        self, message_id: str, thread_id: str, dispatch_id: str, text: str
    ) -> AcceptResult:
        existing = self._conn.execute(
            "SELECT thread_id, dispatch_id, attempt, seq, body, state, accepted_at, delivered_at,"
            " handled_at, outcome FROM messages WHERE message_id = ?",
            (message_id,),
        ).fetchone()
        if existing is not None:
            message = _message_from_row(message_id, existing)
            if (message.thread_id, message.dispatch_id) != (thread_id, dispatch_id):
                return AcceptResult("refused", "message_id_conflict", None, None)
            return AcceptResult("duplicate", None, message, message.attempt)
        running = self._conn.execute(
            "SELECT attempt, state FROM instances WHERE thread_id = ? AND dispatch_id = ?"
            " ORDER BY attempt DESC LIMIT 1",
            (thread_id, dispatch_id),
        ).fetchone()
        if running is None or running[1] != RUNNING:
            return AcceptResult("refused", "instance_not_running", None, None)
        attempt = int(running[0])
        pending = self._conn.execute(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ? AND dispatch_id = ? AND attempt = ?"
            " AND state = ?",
            (thread_id, dispatch_id, attempt, ACCEPTED),
        ).fetchone()[0]
        if pending >= MAX_PENDING:
            return AcceptResult("refused", "mailbox_full", None, attempt)
        seq = self._conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = ? AND dispatch_id = ?"
            " AND attempt = ?",
            (thread_id, dispatch_id, attempt),
        ).fetchone()[0]
        now = self._clock()
        self._conn.execute(
            "INSERT INTO messages (message_id, thread_id, dispatch_id, attempt, seq, body, state, accepted_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (message_id, thread_id, dispatch_id, attempt, int(seq), text, ACCEPTED, now),
        )
        message = MailboxMessage(
            message_id,
            thread_id,
            dispatch_id,
            attempt,
            int(seq),
            text,
            ACCEPTED,
            now,
            None,
            None,
            None,
        )
        return AcceptResult("accepted", None, message, attempt)

    # ── recipient side (called at the instance's safe point) ────────────

    def drain(self, thread_id: str, dispatch_id: str, attempt: int) -> list[MailboxMessage]:
        """Mark every accepted message for this attempt as delivered and return them in order."""
        now = self._clock()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                rows = self._conn.execute(
                    "SELECT message_id, thread_id, dispatch_id, attempt, seq, body, state, accepted_at,"
                    " delivered_at, handled_at, outcome FROM messages WHERE thread_id = ? AND dispatch_id = ?"
                    " AND attempt = ? AND state = ? ORDER BY seq",
                    (thread_id, dispatch_id, attempt, ACCEPTED),
                ).fetchall()
                delivered: list[MailboxMessage] = []
                for row in rows:
                    self._conn.execute(
                        "UPDATE messages SET state = ?, delivered_at = ? WHERE message_id = ?",
                        (DELIVERED, now, row[0]),
                    )
                    delivered.append(
                        MailboxMessage(
                            row[0],
                            row[1],
                            row[2],
                            int(row[3]),
                            int(row[4]),
                            row[5],
                            DELIVERED,
                            row[7],
                            now,
                            row[9],
                            row[10],
                        )
                    )
                self._conn.execute("COMMIT")
                return delivered
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def mark_handled(self, message_ids: list[str], outcome: str) -> None:
        now = self._clock()
        with self._lock:
            for message_id in message_ids:
                self._conn.execute(
                    "UPDATE messages SET state = ?, handled_at = ?, outcome = ? WHERE message_id = ? AND state = ?",
                    (HANDLED, now, outcome, message_id, DELIVERED),
                )

    # ── observation ─────────────────────────────────────────────────────

    def snapshot(
        self, thread_id: str, dispatch_id: str
    ) -> tuple[list[InstanceRow], list[MailboxMessage]]:
        with self._lock:
            instances = [
                InstanceRow(r[0], r[1], int(r[2]), r[3], r[4], r[5], r[6])
                for r in self._conn.execute(
                    "SELECT thread_id, dispatch_id, attempt, role, state, started_at, finished_at FROM instances"
                    " WHERE thread_id = ? AND dispatch_id = ? ORDER BY attempt",
                    (thread_id, dispatch_id),
                ).fetchall()
            ]
            messages = [
                _message_from_row(r[0], r[1:])
                for r in self._conn.execute(
                    "SELECT message_id, thread_id, dispatch_id, attempt, seq, body, state, accepted_at,"
                    " delivered_at, handled_at, outcome FROM messages WHERE thread_id = ? AND dispatch_id = ?"
                    " ORDER BY attempt, seq",
                    (thread_id, dispatch_id),
                ).fetchall()
            ]
        return instances, messages


def _message_from_row(message_id: str, row: tuple) -> MailboxMessage:
    # ``row`` holds (thread_id, dispatch_id, attempt, seq, body, state, accepted_at, delivered_at, handled_at, outcome)
    return MailboxMessage(
        message_id=message_id,
        thread_id=row[0],
        dispatch_id=row[1],
        attempt=int(row[2]),
        seq=int(row[3]),
        body=row[4],
        state=row[5],
        accepted_at=row[6],
        delivered_at=row[7],
        handled_at=row[8],
        outcome=row[9],
    )


_default: InstanceMailbox | None = None
_default_lock = threading.Lock()


def default_mailbox() -> InstanceMailbox:
    """The process-wide mailbox at ``RAPTIX_INSTANCE_MAILBOX_PATH`` (default under ``.langgraph_api``)."""
    global _default
    with _default_lock:
        if _default is None:
            _default = InstanceMailbox(os.environ.get(PATH_ENV, DEFAULT_PATH))
        return _default
