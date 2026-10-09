"""Observe attempted tool edges in the engagement KG without gating actions."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import posixpath
import re
import shlex
import threading
import time
from collections import deque
from types import SimpleNamespace
from typing import Any, cast

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage, ToolMessage

from raptix.knowledge.graph.store import KGStore

log = logging.getLogger(__name__)
_MAX_ENTRIES = 20
_MAX_SECONDS = 4
# Wave D2: how many consecutive identical observations count as a stall, and
# how many distinct (thread, objective) windows are retained in one process.
_STALL_WINDOW = 12
_PROGRESS_MAX_KEYS = 64
_STALL_REMINDER = (
    "<system-reminder>No verifiable progress in the last {n} actions: {technique} "
    "repeated with no state change or new result. Change the approach or its "
    "parameters before retrying; retries are still allowed.</system-reminder>"
)
_SAFE_NAME = re.compile(r"[a-zA-Z][a-zA-Z0-9_.-]{0,31}\Z")
_SAFE_TARGET = re.compile(r"[a-zA-Z0-9.:/_-]{1,120}\Z")
_EXIT_CODE = re.compile(r"\[Exit code: (\d+)(?:[^\]]*)\]\Z")
_OUTCOMES = frozenset({"success", "blocked", "error", "no_change"})
_REASONS = frozenset(
    {
        "exit_zero",
        "roe_refused",
        "emergency_abort",
        "nonzero_exit",
        "tool_error",
        "pending",
        "no_exit_status",
    }
)

_WRITE = (
    "MERGE (a:Candidate {key: $actor_key, engagement: $engagement}) "
    "ON CREATE SET a.label = $actor, a.firstseen = $now, a.created_by = $actor "
    "SET a.lastupdated = $now "
    "MERGE (t:Candidate {key: $target_key, engagement: $engagement}) "
    "ON CREATE SET t.label = $target, t.firstseen = $now, t.created_by = $actor "
    "SET t.lastupdated = $now "
    "MERGE (a)-[r:MAPS_TO {engagement: $engagement, tried_ledger: true}]->(t) "
    "ON CREATE SET r.firstseen = $now "
    "SET r.entries = (coalesce(r.entries, []) + $entry)[-20..], "
    "r.lastupdated = $now, r.created_by = $actor, r.source_episode_id = $call_id "
    "RETURN size(r.entries) AS count"
)
_READ = (
    "MATCH (a:Candidate)-[r:MAPS_TO]->(t:Candidate) "
    "WHERE a.engagement = $engagement AND t.engagement = $engagement "
    "AND r.engagement = $engagement AND r.tried_ledger = true "
    "RETURN r.entries AS entries ORDER BY r.lastupdated DESC LIMIT $cap"
)


def _enabled() -> bool:
    return os.environ.get("RAPTIX_KG_TRIED_EDGES", "0").strip().lower() in {"1", "true", "yes"}


def progress_observe_enabled() -> bool:
    return os.environ.get("RAPTIX_PROGRESS_OBSERVE", "0").strip().lower() in {"1", "true", "yes"}


# Per-call identity that middlewares further in embed into the result the
# observer sees. The untrusted-output envelope carries ``tool_call_id``, which
# is unique on every call, so hashing the enveloped content verbatim makes two
# byte-identical results hash differently and the stall window never becomes
# uniform. Strip the volatile identity before hashing; the conversation is
# never touched.
_VOLATILE_ID = re.compile(r'\btool_call_id="[^"]*"')


def _stable_content(content: Any) -> Any:
    if isinstance(content, str):
        return _VOLATILE_ID.sub("", content)
    if isinstance(content, list):
        return [_stable_content(part) if isinstance(part, str) else part for part in content]
    return content


def _result_hash(result: Any) -> str | None:
    """Hash a bounded, structured view of a tool result: no raw payload stored."""
    if isinstance(result, ToolMessage):
        view: Any = {
            "status": result.status,
            "content": _stable_content(result.content),
            "artifact": result.artifact,
        }
    else:
        update = getattr(result, "update", None)
        if not isinstance(update, dict):
            return None
        view = [
            {
                "content": _stable_content(getattr(m, "content", "")),
                "status": getattr(m, "status", ""),
            }
            for m in update.get("messages", [])
        ]
    encoded = json.dumps(view, sort_keys=True, ensure_ascii=False, default=str).encode()
    return hashlib.sha256(encoded).hexdigest() if len(encoded) <= 1_000_000 else None


def _outcome(message: Any) -> tuple[str, str]:
    if not isinstance(message, ToolMessage):
        return "no_change", "no_exit_status"
    text = message.content if isinstance(message.content, str) else ""
    if message.status == "error":
        if text.startswith("[ROE_REFUSED]"):
            return "blocked", "roe_refused"
        if text.startswith("[AGENT_HALTED]"):
            return "blocked", "emergency_abort"
        return "error", "tool_error"
    if text.startswith(("[BACKGROUND]", "[AUTO-BACKGROUND]")):
        return "no_change", "pending"
    match = _EXIT_CODE.search(text.rstrip())
    if match is not None:
        return ("success", "exit_zero") if match.group(1) == "0" else ("error", "nonzero_exit")
    return "no_change", "no_exit_status"


def _technique(tool_name: str, args: Any) -> str:
    if tool_name == "bash" and isinstance(args, dict) and isinstance(args.get("command"), str):
        try:
            tokens = shlex.split(args["command"])
        except ValueError:
            tokens = []
        if tokens:
            name = posixpath.basename(tokens[0])
            if _SAFE_NAME.fullmatch(name):
                return name
    return tool_name if _SAFE_NAME.fullmatch(tool_name) else "tool"


def _recent_text(rows: list[dict[str, Any]]) -> str:
    entries: list[dict[str, Any]] = []
    for row in rows[:_MAX_ENTRIES]:
        for raw in (row.get("entries") or [])[-_MAX_ENTRIES:]:
            if not isinstance(raw, str) or len(raw) > 512:
                continue
            try:
                item = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if (
                isinstance(item, dict)
                and isinstance(item.get("ts"), int)
                and item.get("outcome") in _OUTCOMES
                and item.get("reason") in _REASONS
                and isinstance(item.get("target"), str)
                and _SAFE_TARGET.fullmatch(item["target"])
                and isinstance(item.get("technique"), str)
                and _SAFE_NAME.fullmatch(item["technique"])
            ):
                entries.append(item)
    if not entries:
        return ""
    entries.sort(key=lambda item: item["ts"], reverse=True)
    lines = ["## Already tried (observational; retries are allowed)"]
    for item in entries[:_MAX_ENTRIES]:
        lines.append(
            f"- {item['target']}: {item['technique']} → {item['outcome']} ({item['reason']})"
        )
    lines.append("Do not blindly repeat; retry with a changed parameter when appropriate.")
    return "\n".join(lines)


class TriedEdgesMiddleware(AgentMiddleware):
    """Keep a bounded, engagement-scoped attempt ledger; never veto a call."""

    def __init__(self, *, store: KGStore | None, role: str, backend: Any = None) -> None:
        super().__init__()
        self._store = store
        self._role = role
        self._backend = backend
        self._slots = threading.BoundedSemaphore(value=2)
        self._lock = threading.Lock()
        self._progress: dict[tuple[str, str], deque] = {}
        self._emitted: dict[tuple[str, str], tuple] = {}
        from raptix.middleware.execution_ledger import ExecutionLedgerMiddleware

        self._io = ExecutionLedgerMiddleware(role="progress-io", backend=backend)
        self._io._slots = self._slots

    def _bounded_call(self, action: Any, *args: Any, **kwargs: Any) -> Any:
        if not self._slots.acquire(blocking=False):
            return []
        try:
            return action(*args, **kwargs)
        finally:
            self._slots.release()

    def wrap_tool_call(self, request: Any, handler: Any) -> Any:
        version = self._io._bounded(self._revision, request) if progress_observe_enabled() else None
        result = handler(request)
        if progress_observe_enabled():
            self._io._bounded(self._observe, request, result, version)
        return result

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:
        version = (
            await self._io._to_thread(self._revision, request)
            if progress_observe_enabled()
            else None
        )
        result = await handler(request)
        if progress_observe_enabled() or (_enabled() and self._store is not None):
            await self._io._to_thread(self._after_tool, request, result, version)
        return result

    def _after_tool(self, request: Any, result: Any, version: str | None) -> None:
        if progress_observe_enabled():
            self._observe(request, result, version)
        if _enabled() and self._store is not None:
            self._record(request, result)

    def _objective(self, request: Any) -> str:
        from raptix.core.dispatch_context import active_dispatch

        context = active_dispatch.get()
        if context is not None and context.objective_id:
            return context.objective_id
        state = getattr(request, "state", None) or {}
        return str(state.get("active_objective_id") or "unscoped")

    def _key(self, request: Any) -> tuple[str, str]:
        # The window fills in ``wrap_tool_call`` but the reminder is looked up
        # in ``wrap_model_call``. ``runtime.config.configurable.thread_id`` is
        # present in the tool-phase request and absent in the model-phase
        # request, so deriving the scope from it makes the two keys diverge and
        # the stall reminder never fires. Prefer the graph-state identity
        # (hydrated identically in both phases); fall back to the thread id
        # only when the state carries no engagement scope at all.
        state = getattr(request, "state", None) or {}
        scope = (
            state.get("engagement_name")
            or state.get("kg_engagement")
            or state.get("workspace_path")
        )
        if not scope:
            config = getattr(getattr(request, "runtime", None), "config", None) or {}
            scope = (config.get("configurable") or {}).get("thread_id") or "default"
        return json.dumps(
            [scope, state.get("workspace_path"), state.get("engagement_name")]
        ), self._objective(request)

    def _revision(self, request: Any) -> str | None:
        state = getattr(request, "state", None) or {}
        version = [
            state.get("kg_revision"),
            state.get("environment_revision"),
            state.get("task_state_revision", 0),
        ]
        try:
            from raptix.orchestration.mission.task_state import (
                read_task_state,
                scoped_task_backend,
            )

            runtime = getattr(request, "runtime", None)
            merged = SimpleNamespace(state=state, config=getattr(runtime, "config", None))
            backend = scoped_task_backend(self._backend, merged)
            if backend is not None:
                bundle = read_task_state(backend, self._objective(request))
                if bundle.error:
                    return None
                version.extend(
                    [
                        bundle.state.state_revision if bundle.state else 0,
                        bundle.state.observed_kg_revision if bundle.state else None,
                    ]
                )
            return hashlib.sha256(json.dumps(version, default=str).encode()).hexdigest()
        except Exception as exc:  # noqa: BLE001 — a progress signal is best-effort
            log.debug("progress revision unavailable: %s", type(exc).__name__)
            return None

    def _observe(self, request: Any, result: Any, before: str | None = None) -> None:
        tool_call = getattr(request, "tool_call", None)
        args = tool_call.get("args") if isinstance(tool_call, dict) else None
        name = getattr(getattr(request, "tool", None), "name", "") or ""
        if not name:
            return
        try:
            from raptix.middleware.execution_ledger import action_hash

            action = action_hash(self._role, name, args, self._objective(request))
        except Exception as exc:  # noqa: BLE001 — hashing never blocks a tool
            log.debug("progress fingerprint skipped: %s", type(exc).__name__)
            return
        after_request = request
        update = getattr(result, "update", None)
        if isinstance(update, dict):
            after_request = SimpleNamespace(
                state={**(request.state or {}), **update}, runtime=getattr(request, "runtime", None)
            )
        after = self._revision(after_request)
        digest = _result_hash(result)
        key = self._key(request)
        if before is None or after is None or digest is None or before != after:
            with self._lock:
                self._progress.pop(key, None)
                self._emitted.pop(key, None)
            self._persist_signal(request, False)
            return
        entry = (action, before, digest, _technique(name, args))
        with self._lock:
            window = self._progress.get(key)
            if window is None:
                if len(self._progress) >= _PROGRESS_MAX_KEYS:
                    oldest = next(iter(self._progress))
                    self._progress.pop(oldest, None)
                    self._emitted.pop(oldest, None)
                window = deque(maxlen=_STALL_WINDOW)
                self._progress[key] = window
            if window and window[-1][1:3] != entry[1:3]:
                self._emitted.pop(key, None)
            window.append(entry)
            stalled = len(window) == _STALL_WINDOW and all(e[1:3] == entry[1:3] for e in window)
        self._persist_signal(request, stalled)

    def _persist_signal(self, request: Any, stalled: bool) -> None:
        if self._backend is None or self._objective(request) == "unscoped":
            return
        from raptix.orchestration.mission.task_state import mutate_task_state, scoped_task_backend

        backend = scoped_task_backend(
            self._backend,
            SimpleNamespace(
                state=request.state,
                config=getattr(getattr(request, "runtime", None), "config", None),
            ),
        )

        def mutate(state: Any) -> None:
            state.handoff_signals = ["stall"] if stalled else []

        mutate_task_state(backend, self._objective(request), mutate)

    def _progress_text(self, request: Any) -> str:
        if not progress_observe_enabled():
            return ""
        key = self._key(request)
        with self._lock:
            window = self._progress.get(key)
            if window is None or len(window) < _STALL_WINDOW:
                return ""
            if any(entry[1:3] != window[-1][1:3] for entry in window):
                self._emitted.pop(key, None)
                return ""
            if self._emitted.get(key) == window[-1]:
                return ""
            self._emitted[key] = window[-1]
            technique = window[-1][3]
        return _STALL_REMINDER.format(n=_STALL_WINDOW, technique=technique)

    @staticmethod
    def _append_system(request: Any, text: str) -> Any:
        content = (
            [*request.system_message.content_blocks] if request.system_message is not None else []
        )
        content.append({"type": "text", "text": "\n\n" + text})
        return request.override(
            system_message=SystemMessage(content=cast("list[str | dict[str, str]]", content))
        )

    def _record(self, request: Any, result: Any) -> None:
        if self._store is None:
            return
        state = getattr(request, "state", None) or {}
        engagement = state.get("engagement_name") or state.get("kg_engagement")
        target = state.get("target_value")
        if (
            not isinstance(engagement, str)
            or not engagement
            or not isinstance(target, str)
            or not target
        ):
            return
        tool_call = getattr(request, "tool_call", None)
        if not isinstance(tool_call, dict) or not tool_call.get("id"):
            return
        name = getattr(getattr(request, "tool", None), "name", "")
        outcome, reason = _outcome(result)
        safe_target = (
            target
            if _SAFE_TARGET.fullmatch(target)
            else hashlib.sha256(target.encode()).hexdigest()[:16]
        )
        event = json.dumps(
            {
                "ts": int(time.time()),
                "target": safe_target,
                "technique": _technique(name, tool_call.get("args")),
                "outcome": outcome,
                "reason": reason,
            },
            separators=(",", ":"),
        )
        self._store.execute_write(
            _WRITE,
            {
                "actor_key": f"tried::actor::{self._role}",
                "target_key": f"tried::target::{hashlib.sha256(target.encode()).hexdigest()}",
                "actor": self._role,
                "target": safe_target,
                "entry": event,
                "call_id": str(tool_call["id"]),
                "now": int(time.time()),
            },
            engagement=engagement,
        )

    def wrap_model_call(self, request: Any, handler: Any) -> Any:
        return handler(self._inject_progress(request))

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        request = await self._inject_kg(request)
        return await handler(self._inject_progress(request))

    async def _inject_kg(self, request: Any) -> Any:
        if not _enabled() or self._store is None:
            return request
        state = request.state or {}
        engagement = state.get("engagement_name") or state.get("kg_engagement")
        if not isinstance(engagement, str) or not engagement:
            return request
        try:
            rows = await asyncio.wait_for(
                asyncio.to_thread(
                    self._bounded_call,
                    self._store.execute_read,
                    _READ,
                    {"cap": _MAX_ENTRIES},
                    engagement=engagement,
                ),
                timeout=_MAX_SECONDS,
            )
            text = _recent_text(rows)
            if text:
                return self._append_system(request, text)
        except Exception as exc:  # noqa: BLE001 — context help never blocks a call
            log.debug("tried-edge context skipped: %s", exc)
        return request

    def _inject_progress(self, request: Any) -> Any:
        try:
            text = self._progress_text(request)
            return self._append_system(request, text) if text else request
        except Exception as exc:
            log.debug("progress reminder unavailable: %s", type(exc).__name__)
            return request
