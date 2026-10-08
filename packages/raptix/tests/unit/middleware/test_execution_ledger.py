"""Execution receipts are observational, bounded, and never alter a tool result."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from deepagents.backends.protocol import EditResult, LsResult, ReadResult, WriteResult
from langchain_core.messages import ToolMessage

from raptix_core.contracts.slots import SLOTS_PER_ROLE
from raptix_core.contracts.slots import MiddlewareSlot as Slot


class MemoryBackend:
    def __init__(self, *, broken: bool = False) -> None:
        self.files: dict[str, str] = {}
        self.broken = broken

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if self.broken:
            raise RuntimeError("backend down")
        if file_path not in self.files:
            return ReadResult(error=f"file_not_found: '{file_path}'")
        return ReadResult(
            file_data={
                "content": self.files[file_path][offset : offset + limit],
                "encoding": "utf-8",
            }
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        if self.broken:
            raise RuntimeError("backend down")
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old: str, new: str, replace_all: bool = False) -> EditResult:
        if self.broken:
            raise RuntimeError("backend down")
        self.files[file_path] = self.files[file_path].replace(old, new)
        return EditResult(path=file_path, occurrences=1)

    def ls_info(self, path: str) -> list:
        return []

    def ls(self, path: str) -> LsResult:
        return LsResult(entries=[])


def _request(objective: str = "OBJ-001", command: str = "nmap -sV 10.0.0.1") -> SimpleNamespace:
    return SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        tool_call={"id": "call-1", "args": {"command": command}},
        state={"workspace_path": "/workspace", "active_objective_id": objective},
        runtime=None,
    )


def test_factory_is_default_off_and_in_base_slots(monkeypatch) -> None:
    from raptix.intelligence.agents.middleware_slots import (
        DEFAULT_SLOT_FACTORIES,
        _make_execution_ledger,
    )

    assert Slot.EXECUTION_LEDGER in DEFAULT_SLOT_FACTORIES
    assert Slot.EXECUTION_LEDGER in SLOTS_PER_ROLE["recon"]
    monkeypatch.delenv("RAPTIX_EXECUTION_LEDGER", raising=False)
    assert _make_execution_ledger(role="recon") is None
    monkeypatch.setenv("RAPTIX_EXECUTION_LEDGER", "1")
    assert _make_execution_ledger(role="recon") is not None


async def test_started_and_succeeded_pair_records_hash_only(monkeypatch) -> None:
    from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

    monkeypatch.setenv("RAPTIX_EXECUTION_LEDGER", "1")
    backend = MemoryBackend()
    middleware = ExecutionLedgerMiddleware(role="recon", backend=backend)
    reply = ToolMessage(content="scan done", tool_call_id="call-1")

    async def downstream(_request):
        return reply

    assert await middleware.awrap_tool_call(_request(), downstream) is reply
    stored = backend.files["/workspace/plan/task-state/OBJ-001.ledger.jsonl"]
    assert '"kind":"started"' in stored
    assert '"kind":"succeeded"' in stored
    assert "action_hash" in stored
    # Raw parameter values must never reach the ledger.
    assert "nmap" not in stored
    assert "10.0.0.1" not in stored


async def test_error_tool_message_records_failed(monkeypatch) -> None:
    from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

    monkeypatch.setenv("RAPTIX_EXECUTION_LEDGER", "1")
    backend = MemoryBackend()
    middleware = ExecutionLedgerMiddleware(role="recon", backend=backend)
    reply = ToolMessage(content="boom", tool_call_id="call-1", status="error")

    async def downstream(_request):
        return reply

    await middleware.awrap_tool_call(_request(), downstream)
    stored = backend.files["/workspace/plan/task-state/OBJ-001.ledger.jsonl"]
    assert '"kind":"failed"' in stored


async def test_write_failure_is_passthrough(monkeypatch) -> None:
    from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

    monkeypatch.setenv("RAPTIX_EXECUTION_LEDGER", "1")
    middleware = ExecutionLedgerMiddleware(role="recon", backend=MemoryBackend(broken=True))
    reply = ToolMessage(content="scan done", tool_call_id="call-1")

    async def downstream(_request):
        return reply

    assert await middleware.awrap_tool_call(_request(), downstream) is reply


async def test_handler_exception_records_failed_and_reraises(monkeypatch) -> None:
    from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

    monkeypatch.setenv("RAPTIX_EXECUTION_LEDGER", "1")
    backend = MemoryBackend()
    middleware = ExecutionLedgerMiddleware(role="recon", backend=backend)

    async def downstream(_request):
        raise RuntimeError("tool exploded")

    with pytest.raises(RuntimeError, match="tool exploded"):
        await middleware.awrap_tool_call(_request(), downstream)
    stored = backend.files["/workspace/plan/task-state/OBJ-001.ledger.jsonl"]
    assert '"kind":"failed"' in stored


async def test_flag_off_writes_nothing(monkeypatch) -> None:
    from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

    monkeypatch.delenv("RAPTIX_EXECUTION_LEDGER", raising=False)
    backend = MemoryBackend()
    middleware = ExecutionLedgerMiddleware(role="recon", backend=backend)
    reply = ToolMessage(content="scan done", tool_call_id="call-1")

    async def downstream(_request):
        return reply

    assert await middleware.awrap_tool_call(_request(), downstream) is reply
    assert backend.files == {}


def test_sync_wrap_records_receipt(monkeypatch) -> None:
    from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

    monkeypatch.setenv("RAPTIX_EXECUTION_LEDGER", "1")
    backend = MemoryBackend()
    middleware = ExecutionLedgerMiddleware(role="recon", backend=backend)
    reply = ToolMessage(content="scan done", tool_call_id="call-1")

    assert middleware.wrap_tool_call(_request(), lambda _r: reply) is reply
    stored = backend.files["/workspace/plan/task-state/OBJ-001.ledger.jsonl"]
    assert '"kind":"succeeded"' in stored


def test_reconcile_marks_dangling_started_outcome_unknown() -> None:
    from raptix.middleware.execution_ledger import reconcile_receipts

    entries = [
        {"kind": "started", "receipt_id": "a", "action_hash": "h1"},
        {"kind": "started", "receipt_id": "b", "action_hash": "h2"},
        {"kind": "succeeded", "receipt_id": "a", "action_hash": "h1"},
    ]
    reconciled = reconcile_receipts(entries)
    kinds = {(e["receipt_id"], e["kind"]) for e in reconciled}
    assert ("a", "succeeded") in kinds
    assert ("b", "outcome_unknown") in kinds
    # A completed receipt is never rewritten to unknown.
    assert ("a", "outcome_unknown") not in kinds


def test_action_hash_is_stable_and_value_sensitive() -> None:
    from raptix.middleware.execution_ledger import action_hash

    first = action_hash("recon", "bash", {"command": "x", "timeout": 1}, "OBJ-001")
    reordered = action_hash("recon", "bash", {"timeout": 1, "command": "x"}, "OBJ-001")
    changed = action_hash("recon", "bash", {"command": "y", "timeout": 1}, "OBJ-001")
    assert first == reordered
    assert first != changed
