"""Durable mailbox for running dispatch instances (plan P10c).

An operator message to a running instance moves through four durable states:

- ``accepted``: enqueued durably; the recipient has not seen it yet.
- ``delivered``: offered at the recipient's safe point; retried until its model turn completes.
- ``handled``: the model turn that received it completed.
- ``undelivered``: the instance ended before its next safe point.

``accepted`` is only a durable enqueue; it is not a delivery. A message is deduplicated by its
client-supplied id, so a retried request never creates a second message. Instances left active on restart are
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
    # Set when the operator forwarded this message from another attempt's message; never automatic.
    source_message_id: str | None = None


@dataclass(frozen=True)
class InstanceRow:
    thread_id: str
    dispatch_id: str
    attempt: int
    role: str | None
    state: str
    started_at: str
    finished_at: str | None
    # The task description and objective the attempt ran with; a retry re-issues exactly this intent.
    intent: str | None = None
    objective_id: str | None = None


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
        # Additive migrations for stores created before intent and forwarding were recorded.
        for table, column in (("instances", "intent"), ("instances", "objective_id"), ("messages", "source_message_id")):
            if column not in {row[1] for row in self._conn.execute(f"PRAGMA table_info({table})")}:
                self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT")
        self._conn.execute(
            "UPDATE instances SET state = ?, finished_at = ? WHERE state IN (?, ?)",
            (INTERRUPTED, self._clock(), RUNNING, "cancel_requested"),
        )
        self._conn.execute(
            "UPDATE messages SET state = ?, outcome = 'instance_interrupted' WHERE state IN (?, ?)"
            " AND EXISTS (SELECT 1 FROM instances i WHERE i.thread_id = messages.thread_id"
            " AND i.dispatch_id = messages.dispatch_id AND i.attempt = messages.attempt AND i.state = ?)",
            (UNDELIVERED, ACCEPTED, DELIVERED, INTERRUPTED),
        )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ── instance lifecycle ──────────────────────────────────────────────

    def start_instance(
        self,
        thread_id: str,
        dispatch_id: str,
        attempt: int,
        role: str | None,
        intent: str | None = None,
        objective_id: str | None = None,
    ) -> None:
        now = self._clock()
        with self._lock:
            self._conn.execute(
                "INSERT INTO instances (thread_id, dispatch_id, attempt, role, state, started_at, updated_at, intent,"
                " objective_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (thread_id, dispatch_id, attempt) DO NOTHING",
                (thread_id, dispatch_id, attempt, role, RUNNING, now, now, intent, objective_id),
            )

    def max_attempt(self, thread_id: str, dispatch_id: str) -> int:
        """Highest attempt the mailbox ever started for a dispatch; a new attempt must go above it."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COALESCE(MAX(attempt), 0) FROM instances WHERE thread_id = ? AND dispatch_id = ?",
                (thread_id, dispatch_id),
            ).fetchone()
            return int(row[0])

    def finish_instance(self, thread_id: str, dispatch_id: str, attempt: int, *, interrupted: bool = False) -> None:
        now = self._clock()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute(
                    "UPDATE instances SET state = CASE WHEN state = 'cancel_requested' THEN 'cancelled' ELSE ? END, finished_at = ?, updated_at = ?"
                    " WHERE thread_id = ? AND dispatch_id = ? AND attempt = ? AND state IN (?, 'cancel_requested')",
                    (INTERRUPTED if interrupted else FINISHED, now, now, thread_id, dispatch_id, attempt, RUNNING),
                )
                self._conn.execute(
                    "UPDATE messages SET state = ?, outcome = ? WHERE thread_id = ? AND dispatch_id = ?"
                    " AND attempt = ? AND state IN (?, ?)",
                    (UNDELIVERED, "instance_interrupted" if interrupted else "instance_finished", thread_id, dispatch_id, attempt, ACCEPTED, DELIVERED),
                )
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    # ── operator side ───────────────────────────────────────────────────

    def accept(
        self,
        message_id: str,
        thread_id: str,
        dispatch_id: str,
        body: str,
        *,
        expected_attempt: int | None = None,
        source_message_id: str | None = None,
    ) -> AcceptResult:
        """Durably enqueue one message for the instance's running attempt."""
        if not _MESSAGE_ID.fullmatch(message_id):
            return AcceptResult("refused", "invalid_message_id", None, None)
        if source_message_id is not None and not _MESSAGE_ID.fullmatch(source_message_id):
            return AcceptResult("refused", "invalid_message_id", None, None)
        text = body.strip()
        if not text:
            return AcceptResult("refused", "empty_message", None, None)
        if len(text) > MAX_BODY_CHARS:
            return AcceptResult("refused", "message_too_large", None, None)
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                result = self._accept_locked(
                    message_id, thread_id, dispatch_id, text, expected_attempt, source_message_id
                )
                self._conn.execute("COMMIT")
                return result
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def _accept_locked(
        self,
        message_id: str,
        thread_id: str,
        dispatch_id: str,
        text: str,
        expected_attempt: int | None,
        source_message_id: str | None,
    ) -> AcceptResult:
        existing = self._conn.execute(
            "SELECT thread_id, dispatch_id, attempt, seq, body, state, accepted_at, delivered_at,"
            " handled_at, outcome, source_message_id FROM messages WHERE message_id = ?",
            (message_id,),
        ).fetchone()
        if existing is not None:
            message = _message_from_row(message_id, existing)
            if ((message.thread_id, message.dispatch_id, message.body, message.source_message_id)
                    != (thread_id, dispatch_id, text, source_message_id)
                or expected_attempt is not None and message.attempt != expected_attempt):
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
        if expected_attempt is not None and attempt != expected_attempt:
            return AcceptResult("refused", "stale_attempt", None, attempt)
        pending = self._conn.execute(
            "SELECT COUNT(*) FROM messages WHERE thread_id = ? AND dispatch_id = ? AND attempt = ?"
            " AND state IN (?, ?)",
            (thread_id, dispatch_id, attempt, ACCEPTED, DELIVERED),
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
            "INSERT INTO messages (message_id, thread_id, dispatch_id, attempt, seq, body, state, accepted_at,"
            " source_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (message_id, thread_id, dispatch_id, attempt, int(seq), text, ACCEPTED, now, source_message_id),
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
            source_message_id,
        )
        return AcceptResult("accepted", None, message, attempt)

    # ── recipient side (called at the instance's safe point) ────────────

    def drain(self, thread_id: str, dispatch_id: str, attempt: int) -> list[MailboxMessage]:
        """Offer pending guidance, including failed turns, only to its pinned live attempt."""
        now = self._clock()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                live = self._conn.execute(
                    "SELECT state FROM instances WHERE thread_id = ? AND dispatch_id = ? AND attempt = ?",
                    (thread_id, dispatch_id, attempt),
                ).fetchone()
                if live is None or live[0] != RUNNING:
                    self._conn.execute("COMMIT")
                    return []
                rows = self._conn.execute(
                    "SELECT message_id, thread_id, dispatch_id, attempt, seq, body, state, accepted_at,"
                    " delivered_at, handled_at, outcome, source_message_id FROM messages WHERE thread_id = ?"
                    " AND dispatch_id = ? AND attempt = ? AND state IN (?, ?) ORDER BY seq",
                    (thread_id, dispatch_id, attempt, ACCEPTED, DELIVERED),
                ).fetchall()
                delivered: list[MailboxMessage] = []
                for row in rows:
                    self._conn.execute(
                        "UPDATE messages SET state = ?, delivered_at = ? WHERE message_id = ?",
                        (DELIVERED, now, row[0]),
                    )
                    delivered.append(_message_from_row(row[0], row[1:], state=DELIVERED, delivered_at=now))
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

    def list_instances(self, thread_id: str) -> list[tuple[str, InstanceRow]]:
        """Every attempt the mailbox recorded on a thread, in start order (includes running attempts)."""
        with self._lock:
            return [
                (
                    r[1],
                    InstanceRow(r[0], r[1], int(r[2]), r[3], r[4], r[5], r[6]),
                )
                for r in self._conn.execute(
                    "SELECT thread_id, dispatch_id, attempt, role, state, started_at, finished_at FROM instances"
                    " WHERE thread_id = ? ORDER BY started_at, dispatch_id, attempt",
                    (thread_id,),
                ).fetchall()
            ]

    def snapshot(
        self, thread_id: str, dispatch_id: str
    ) -> tuple[list[InstanceRow], list[MailboxMessage]]:
        with self._lock:
            instances = [
                InstanceRow(r[0], r[1], int(r[2]), r[3], r[4], r[5], r[6], r[7], r[8])
                for r in self._conn.execute(
                    "SELECT thread_id, dispatch_id, attempt, role, state, started_at, finished_at, intent, objective_id"
                    " FROM instances WHERE thread_id = ? AND dispatch_id = ? ORDER BY attempt",
                    (thread_id, dispatch_id),
                ).fetchall()
            ]
            messages = [
                _message_from_row(r[0], r[1:])
                for r in self._conn.execute(
                    "SELECT message_id, thread_id, dispatch_id, attempt, seq, body, state, accepted_at,"
                    " delivered_at, handled_at, outcome, source_message_id FROM messages WHERE thread_id = ?"
                    " AND dispatch_id = ? ORDER BY attempt, seq",
                    (thread_id, dispatch_id),
                ).fetchall()
            ]
        return instances, messages

    def request_cancel(self, thread_id: str, dispatch_id: str, attempt: int) -> str:
        """Persist cancellation intent; only dispatch finalization observes termination."""
        with self._lock:
            changed = self._conn.execute(
                "UPDATE instances SET state = 'cancel_requested', updated_at = ?"
                " WHERE thread_id = ? AND dispatch_id = ? AND attempt = ? AND state = ?",
                (self._clock(), thread_id, dispatch_id, attempt, RUNNING),
            ).rowcount
            row = self._conn.execute(
                "SELECT state FROM instances WHERE thread_id = ? AND dispatch_id = ? AND attempt = ?",
                (thread_id, dispatch_id, attempt),
            ).fetchone()
            return "cancel_requested" if changed else (str(row[0]) if row else "not_found")

    def cancellation_requested(self, thread_id: str, dispatch_id: str, attempt: int) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT state FROM instances WHERE thread_id = ? AND dispatch_id = ? AND attempt = ?",
                (thread_id, dispatch_id, attempt),
            ).fetchone()
            return row is not None and row[0] in {"cancel_requested", "cancelled", INTERRUPTED}


def _message_from_row(
    message_id: str, row: tuple, *, state: str | None = None, delivered_at: str | None = None
) -> MailboxMessage:
    # ``row`` holds (thread_id, dispatch_id, attempt, seq, body, state, accepted_at, delivered_at, handled_at, outcome, source_message_id)
    return MailboxMessage(
        message_id=message_id,
        thread_id=row[0],
        dispatch_id=row[1],
        attempt=int(row[2]),
        seq=int(row[3]),
        body=row[4],
        state=state or row[5],
        accepted_at=row[6],
        delivered_at=delivered_at or row[7],
        handled_at=row[8],
        outcome=row[9],
        source_message_id=row[10],
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
