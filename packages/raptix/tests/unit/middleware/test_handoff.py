"""Handoff leases prevent concurrent ownership and surface unknown executions."""

from __future__ import annotations

import json
from types import SimpleNamespace

from deepagents.backends.protocol import EditResult, LsResult, ReadResult, WriteResult
from langchain_core.runnables import RunnableLambda
from langgraph.types import Command

from raptix.orchestration.mission import handoff
from raptix.orchestration.mission.task_state import (
    OwnerLease,
    TaskState,
    read_task_state,
    write_task_state,
)


class MemoryBackend:
    def __init__(self) -> None:
        self.files: dict[str, str] = {}

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if file_path not in self.files:
            return ReadResult(error=f"file_not_found: '{file_path}'")
        return ReadResult(
            file_data={
                "content": self.files[file_path][offset : offset + limit],
                "encoding": "utf-8",
            }
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old: str, new: str, replace_all: bool = False) -> EditResult:
        self.files[file_path] = self.files[file_path].replace(old, new)
        return EditResult(path=file_path, occurrences=1)

    def ls_info(self, path: str) -> list:
        return []

    def ls(self, path: str) -> LsResult:
        return LsResult(entries=[])


def _state(backend, objective_id="OBJ-001") -> TaskState:
    state = read_task_state(backend, objective_id).state
    assert state is not None
    return state


def _lease(backend, objective_id="OBJ-001") -> OwnerLease:
    lease = _state(backend, objective_id).owner_lease
    assert lease is not None
    return lease


def test_flag_defaults_off_and_truthy_values_enable(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_TASK_HANDOFF", raising=False)
    assert handoff.handoff_enabled() is False
    monkeypatch.setenv("RAPTIX_TASK_HANDOFF", "yes")
    assert handoff.handoff_enabled() is True


def test_claim_refuses_unexpired_other_owner() -> None:
    backend = MemoryBackend()
    assert handoff.claim_lease(backend, "OBJ-001", token="A", now=1000, ttl_s=900) is None
    refused = handoff.claim_lease(backend, "OBJ-001", token="B", now=1100, ttl_s=900)
    assert refused is not None and "lease held" in refused
    assert _lease(backend).token == "A"


def test_expired_lease_is_replaceable() -> None:
    backend = MemoryBackend()
    handoff.claim_lease(backend, "OBJ-001", token="A", now=1000, ttl_s=100)
    assert handoff.claim_lease(backend, "OBJ-001", token="B", now=1200, ttl_s=100) is None
    assert _lease(backend).token == "B"


def test_same_token_renews_lease() -> None:
    backend = MemoryBackend()
    handoff.claim_lease(backend, "OBJ-001", token="A", now=1000, ttl_s=100)
    handoff.claim_lease(backend, "OBJ-001", token="A", now=1050, ttl_s=100)
    assert _lease(backend).expires_at == 1150


def test_release_requires_current_token() -> None:
    backend = MemoryBackend()
    handoff.claim_lease(backend, "OBJ-001", token="A", now=1000, ttl_s=900)
    assert handoff.release_lease(backend, "OBJ-001", "B") is False
    assert _lease(backend).token == "A"
    assert handoff.release_lease(backend, "OBJ-001", "A") is True
    assert _state(backend).owner_lease is None


def test_stale_owner_is_not_recognised_after_handover() -> None:
    backend = MemoryBackend()
    handoff.claim_lease(backend, "OBJ-001", token="A", now=1000, ttl_s=100)
    handoff.claim_lease(backend, "OBJ-001", token="B", now=1200, ttl_s=100)
    assert handoff.lease_owner(backend, "OBJ-001", "B") is True
    assert handoff.lease_owner(backend, "OBJ-001", "A") is False


def test_lease_mutations_do_not_advance_revision() -> None:
    backend = MemoryBackend()
    write_task_state(backend, TaskState(objective_id="OBJ-001", state_revision=5))
    handoff.claim_lease(backend, "OBJ-001", token="A", now=1000, ttl_s=900)
    handoff.release_lease(backend, "OBJ-001", "A")
    assert _state(backend).state_revision == 5


def test_handoff_reason_priority() -> None:
    assert (
        handoff.handoff_reason(requested=True, budget_exhausted=True)
        is handoff.HandoffReason.OPERATOR
    )
    assert (
        handoff.handoff_reason(budget_exhausted=True, stalled=True)
        is handoff.HandoffReason.BUDGET_EXHAUSTED
    )
    assert handoff.handoff_reason(stalled=True, phase_changed=True) is handoff.HandoffReason.STALL
    assert handoff.handoff_reason(phase_changed=True) is handoff.HandoffReason.PHASE_TRANSITION
    assert handoff.handoff_reason() is None


def test_pending_executions_surface_only_unknown_outcomes() -> None:
    backend = MemoryBackend()
    entries = [
        {
            "ts": 1,
            "kind": "planned",
            "receipt_id": "r1",
            "action_hash": "h1",
            "tool": "bash",
            "objective_id": "OBJ-001",
        },
        {
            "ts": 1,
            "kind": "started",
            "receipt_id": "r1",
            "action_hash": "h1",
            "tool": "bash",
            "objective_id": "OBJ-001",
        },
        {
            "ts": 2,
            "kind": "planned",
            "receipt_id": "r2",
            "action_hash": "h2",
            "tool": "bash",
            "objective_id": "OBJ-001",
        },
        {
            "ts": 2,
            "kind": "started",
            "receipt_id": "r2",
            "action_hash": "h2",
            "tool": "bash",
            "objective_id": "OBJ-001",
        },
        {
            "ts": 3,
            "kind": "succeeded",
            "receipt_id": "r2",
            "action_hash": "h2",
            "tool": "bash",
            "objective_id": "OBJ-001",
        },
    ]
    backend.files["/workspace/plan/task-state/OBJ-001.ledger.jsonl"] = "\n".join(
        json.dumps(entry) for entry in entries
    )
    pending = handoff.pending_executions(backend, "OBJ-001")
    assert len(pending) == 1
    assert pending[0]["action_hash"] == "h1"
    assert pending[0]["kind"] == "outcome_unknown"


def _runtime():
    return SimpleNamespace(
        state={"workspace_path": "/workspace", "objectives": [{"id": "A", "title": "task"}]},
        config={"configurable": {"thread_id": "thread"}},
        tool_call_id="dispatch-call",
    )


def _dispatch(backend):
    from raptix.middleware.dispatch import DispatchMiddleware

    return DispatchMiddleware(
        backend=backend,
        subagents=[
            {
                "name": "worker",
                "description": "test",
                "runnable": RunnableLambda(lambda state: {"messages": []}),
            }
        ],
    )


def test_second_dispatch_is_refused_while_lease_held(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TASK_HANDOFF", "1")
    monkeypatch.delenv("RAPTIX_DISPATCH_HANDOFF", raising=False)
    backend = MemoryBackend()
    middleware = _dispatch(backend)
    first = middleware._prepare("work", "worker", _runtime(), "A", "first")
    assert isinstance(first, tuple)
    second = middleware._prepare("work", "worker", _runtime(), "A", "second")
    assert isinstance(second, Command)
    updates = second.update or {}
    assert '"handoff_lease_held"' in updates["messages"][0].content


def test_flag_off_dispatch_writes_no_lease(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_TASK_HANDOFF", raising=False)
    backend = MemoryBackend()
    middleware = _dispatch(backend)
    prepared = middleware._prepare("work", "worker", _runtime(), "A", "first")
    assert isinstance(prepared, tuple)
    assert backend.files == {}
