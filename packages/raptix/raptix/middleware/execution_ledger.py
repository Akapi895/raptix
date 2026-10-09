"""Fail-safe execution receipts (ADR-0050, Wave B2).

Every side-effecting tool call leaves a coarse receipt — ``started`` before the
tool runs, ``succeeded``/``failed`` after — keyed by an idempotency hash so an
interrupted run can be reconciled later: a dangling ``started`` becomes
``outcome_unknown``, never an assumed success (invariant I-7).

Receipts are observational. The hook never alters the tool result, never
raises, is bounded in time and concurrency, and stores only an action hash —
never raw parameter values (telemetry rule). Off by default
(``RAPTIX_EXECUTION_LEDGER``).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import posixpath
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command

from raptix.core.dispatch_context import active_dispatch
from raptix.orchestration.mission.objective_context import ObjectiveContextState
from raptix.orchestration.mission.task_state import (
    TASK_STATE_DIR,
    EvidenceRef,
    WorkerResult,
    _looks_missing,
    _read_text,
    _safe_objective_id,
    _upsert_text,
    document_lock,
    mutate_task_state,
    scoped_task_backend,
)

log = logging.getLogger(__name__)

_MAX_SECONDS = 4
_MAX_ENTRIES = 200
_TERMINAL_KINDS = frozenset({"succeeded", "failed", "outcome_unknown"})
_WRITERS = ThreadPoolExecutor(max_workers=2, thread_name_prefix="execution-receipts")
_WRITE_SLOTS = threading.BoundedSemaphore(2)


def execution_ledger_enabled() -> bool:
    return os.environ.get("RAPTIX_EXECUTION_LEDGER", "0").strip().lower() in {"1", "true", "yes"}


def _canonical(value: Any) -> Any:
    """Deterministically order mappings and coerce exotic values to a type name."""
    if isinstance(value, dict):
        return {str(k): _canonical(v) for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, (list, tuple)):
        return [_canonical(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return type(value).__name__


def action_hash(role: str, tool_name: str, args: Any, objective_id: str) -> str:
    """Idempotency key: role + tool + canonical args + objective. Hash only."""
    canonical = json.dumps(
        [role, tool_name, _canonical(args), objective_id], ensure_ascii=False, default=str
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _safe_filename(objective_id: str) -> str:
    return _safe_objective_id(objective_id)


def ledger_path(objective_id: str) -> str:
    return posixpath.join(TASK_STATE_DIR, f"{_safe_filename(objective_id)}.ledger.jsonl")


def _outcome(result: Any) -> str:
    if isinstance(result, Command):
        messages = (result.update or {}).get("messages", [])
        outcomes = [_outcome(message) for message in messages]
        return (
            "failed"
            if "failed" in outcomes
            else ("outcome_unknown" if "outcome_unknown" in outcomes else "succeeded")
        )
    if not isinstance(result, ToolMessage):
        return "outcome_unknown"
    if result.status == "error":
        return "failed"
    text = str(result.content)
    if "[BACKGROUND]" in text or "[AUTO-BACKGROUND]" in text:
        return "outcome_unknown"
    exits = re.findall(r"\[Exit code: (\d+)(?:[^\]]*)\]", text)
    if exits and exits[-1] != "0":
        return "failed"
    return "succeeded"


def reconcile_receipts(entries: list[dict]) -> list[dict]:
    """Mark dangling ``started`` receipts ``outcome_unknown`` (resume reconciliation).

    A receipt whose ``receipt_id`` has no terminal sibling never completed;
    it must not be read back as success (D3 consumes this).
    """
    terminal = {e.get("receipt_id") for e in entries if e.get("kind") in _TERMINAL_KINDS}
    reconciled: list[dict] = []
    for entry in entries:
        if entry.get("kind") == "started" and entry.get("receipt_id") not in terminal:
            reconciled.append({**entry, "kind": "outcome_unknown"})
        else:
            reconciled.append(entry)
    return reconciled


def _load_entries(backend: Any, path: str) -> list[dict]:
    content, error = _read_text(backend, path)
    if error and not _looks_missing(error):
        raise OSError("ledger read failed")
    if not content:
        return []
    entries: list[dict] = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError("malformed execution ledger") from exc
        expected = {"ts", "kind", "receipt_id", "action_hash", "tool", "objective_id"}
        if not isinstance(item, dict) or set(item) != expected:
            raise ValueError("invalid execution receipt fields")
        entries.append(item)
    if len(entries) > _MAX_ENTRIES:
        raise ValueError("execution ledger exceeds entry cap")
    return entries


def _write_entries(backend: Any, path: str, entries: list[dict]) -> None:
    content = "\n".join(json.dumps(e, separators=(",", ":"), ensure_ascii=False) for e in entries)
    error = _upsert_text(backend, path, content)
    if error:
        raise OSError("ledger write failed")


class ExecutionLedgerMiddleware(AgentMiddleware):
    """Record bounded execution receipts; never alter or suppress a tool result."""

    state_schema = ObjectiveContextState

    def __init__(self, *, role: str, backend: Any = None) -> None:
        super().__init__()
        self._role = role
        self._backend = backend
        self._slots = threading.BoundedSemaphore(value=2)

    def wrap_tool_call(self, request: Any, handler: Any) -> Any:
        if not execution_ledger_enabled():
            return handler(request)
        receipt = self._receipt(request)
        self._bounded(self._start, request, receipt)
        try:
            result = handler(request)
        except Exception:
            self._bounded(self._finish, request, receipt, "failed")
            raise
        self._bounded(self._finish, request, receipt, _outcome(result), result)
        return result

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:
        if not execution_ledger_enabled():
            return await handler(request)
        receipt = self._receipt(request)
        await self._to_thread(self._start, request, receipt)
        try:
            result = await handler(request)
        except Exception:
            await self._to_thread(self._finish, request, receipt, "failed")
            raise
        await self._to_thread(self._finish, request, receipt, _outcome(result), result)
        return result

    def _bounded(self, action: Any, *args: Any) -> Any:
        future = self._submit(action, *args)
        if future is None:
            return None
        try:
            return future.result(timeout=_MAX_SECONDS / 2)
        except Exception as exc:  # noqa: BLE001 — hook failure never blocks a tool
            log.debug("execution-ledger write skipped: %s", type(exc).__name__)
            return None

    def _submit(self, action: Any, *args: Any) -> Any:
        if not self._slots.acquire(blocking=False):
            return None
        if not _WRITE_SLOTS.acquire(blocking=False):
            self._slots.release()
            return None

        context = copy_context()

        def run() -> Any:
            try:
                return context.run(action, *args)
            finally:
                self._slots.release()
                _WRITE_SLOTS.release()

        try:
            future = _WRITERS.submit(run)
        except RuntimeError as exc:
            self._slots.release()
            _WRITE_SLOTS.release()
            log.debug("execution writer unavailable: %s", type(exc).__name__)
            return None
        future.add_done_callback(lambda completed: completed.exception())
        return future

    async def _to_thread(self, action: Any, *args: Any) -> Any:
        future = self._submit(action, *args)
        if future is None:
            return None
        try:
            return await asyncio.wait_for(
                asyncio.shield(asyncio.wrap_future(future)), timeout=_MAX_SECONDS / 2
            )
        except Exception as exc:  # noqa: BLE001 — hook failure never blocks a tool
            log.debug("execution-ledger write skipped: %s", type(exc).__name__)
            return None

    def _backend_for(self, request: Any) -> Any:
        runtime = getattr(request, "runtime", None) or request
        return scoped_task_backend(self._backend, runtime)

    def _receipt(self, request: Any) -> dict | None:
        tool_name = getattr(getattr(request, "tool", None), "name", "") or ""
        if not tool_name:
            return None
        state = getattr(request, "state", None) or {}
        context = active_dispatch.get()
        objective_id = str(
            (context.objective_id if context else None)
            or state.get("active_objective_id")
            or "unscoped"
        )
        tool_call = getattr(request, "tool_call", None)
        args = tool_call.get("args") if isinstance(tool_call, dict) else None
        try:
            fingerprint = action_hash(self._role, tool_name, args, objective_id)
        except Exception as exc:  # noqa: BLE001 — hashing must not block the tool
            log.debug("execution receipt skipped: %s", type(exc).__name__)
            return None
        return {
            "ts": int(time.time()),
            "kind": "started",
            "receipt_id": uuid.uuid4().hex[:16],
            "action_hash": fingerprint,
            "tool": tool_name,
            "objective_id": objective_id,
        }

    def _start(self, request: Any, receipt: dict | None) -> None:
        if receipt is not None:
            self._append(request, [dict(receipt, kind="planned"), receipt])

    def _finish(self, request: Any, receipt: dict | None, kind: str, result: Any = None) -> None:
        if not receipt:
            return
        self._append(
            request,
            [
                {
                    "ts": int(time.time()),
                    "kind": kind,
                    "receipt_id": receipt["receipt_id"],
                    "action_hash": receipt["action_hash"],
                    "tool": receipt["tool"],
                    "objective_id": receipt["objective_id"],
                }
            ],
        )
        artifact = getattr(result, "artifact", None)
        if (
            kind == "succeeded"
            and isinstance(artifact, dict)
            and isinstance(artifact.get("evidence_refs"), list)
        ):
            backend = self._backend_for(request)
            verified = []
            for candidate in artifact["evidence_refs"][:4]:
                reference = EvidenceRef.model_validate(candidate)
                if not reference.ref.startswith("/workspace/") or not reference.sha256:
                    continue
                recovered = backend.read(reference.ref, offset=0, limit=1_000_001)
                if recovered.error or not recovered.file_data:
                    continue
                content = recovered.file_data.get("content")
                if (
                    isinstance(content, str)
                    and len(content.encode()) <= 1_000_000
                    and hashlib.sha256(content.encode()).hexdigest() == reference.sha256.lower()
                ):
                    verified.append(reference)

            def persist(state: Any) -> None:
                refs = {ref.ref: ref for ref in state.evidence_refs}
                fresh = any(
                    ref.ref not in refs or refs[ref.ref].sha256 != ref.sha256 for ref in verified
                )
                refs.update({ref.ref: ref for ref in verified})
                state.evidence_refs = list(refs.values())[-50:]
                if fresh:
                    state.state_revision += 1
                    state.updated_by = "execution-evidence"

            if verified:
                mutate_task_state(backend, str(receipt["objective_id"]), persist)

    def _append(self, request: Any, additions: list[dict]) -> None:
        backend = self._backend_for(request)
        if backend is None:
            return
        path = ledger_path(str(additions[0]["objective_id"]))
        with document_lock(path):
            entries = _load_entries(backend, path) + additions
            while len(entries) > _MAX_ENTRIES:
                terminal = next(
                    (e["receipt_id"] for e in entries if e.get("kind") in _TERMINAL_KINDS), None
                )
                if terminal is None:
                    raise ValueError("ledger full of pending executions")
                entries = [e for e in entries if e.get("receipt_id") != terminal]
            _write_entries(backend, path, entries)

    def before_agent(self, state: Any, runtime: Any) -> dict | None:
        if active_dispatch.get() is not None and any(
            os.environ.get(flag, "0").strip().lower() in {"1", "true", "yes"}
            for flag in ("RAPTIX_DISPATCH_HANDOFF", "RAPTIX_TASK_HANDOFF")
        ):
            return {"worker_result": {}}
        return None

    async def abefore_agent(self, state: Any, runtime: Any) -> dict | None:
        return self.before_agent(state, runtime)

    def after_agent(self, state: Any, runtime: Any) -> dict | None:
        if not any(
            os.environ.get(flag, "0").strip().lower() in {"1", "true", "yes"}
            for flag in ("RAPTIX_DISPATCH_HANDOFF", "RAPTIX_TASK_HANDOFF")
        ):
            return None
        context = active_dispatch.get()
        if context is None or not context.objective_id:
            return None
        messages = state.get("messages", [])
        if (
            not messages
            or not isinstance(messages[-1], AIMessage)
            or not isinstance(messages[-1].content, str)
        ):
            return None
        try:
            text = messages[-1].content.strip()
            if text.startswith("```json") and text.endswith("```"):
                text = text.removeprefix("```json").removesuffix("```").strip()
            reported = WorkerResult.model_validate_json(text)
        except ValueError:
            return None
        if reported.objective_id != context.objective_id:
            return None
        return {"worker_result": reported.model_dump(mode="json")}

    async def aafter_agent(self, state: Any, runtime: Any) -> dict | None:
        return self.after_agent(state, runtime)


__all__ = [
    "ExecutionLedgerMiddleware",
    "action_hash",
    "execution_ledger_enabled",
    "ledger_path",
    "reconcile_receipts",
]
