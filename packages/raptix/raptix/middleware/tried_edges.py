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


def _result_hash(result: Any) -> str:
    """Hash a bounded, structured view of a tool result: no raw payload stored."""
    if isinstance(result, ToolMessage):
        view: Any = {"status": result.status, "content": str(result.content)[:4096]}
    else:
        view = {"type": type(result).__name__}
    return hashlib.sha256(
        json.dumps(view, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


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

    def _bounded_call(self, action: Any, *args: Any, **kwargs: Any) -> Any:
        if not self._slots.acquire(blocking=False):
            return []
        try:
            return action(*args, **kwargs)
        finally:
            self._slots.release()

    def wrap_tool_call(self, request: Any, handler: Any) -> Any:
        result = handler(request)
        if progress_observe_enabled():
            try:
                self._bounded_call(self._observe, request, result)
            except Exception as exc:  # noqa: BLE001 — observation never blocks a tool
                log.debug("progress observation skipped: %s", exc)
        return result

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:
        result = await handler(request)
        if progress_observe_enabled() or (_enabled() and self._store is not None):
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(self._after_tool, request, result),
                    timeout=_MAX_SECONDS,
                )
            except Exception as exc:  # noqa: BLE001 — observation never blocks a tool
                log.debug("tried-edge recording skipped: %s", exc)
        return result

    def _after_tool(self, request: Any, result: Any) -> None:
        if progress_observe_enabled():
            self._observe(request, result)
        if _enabled() and self._store is not None:
            self._bounded_call(self._record, request, result)

    def _objective(self, request: Any) -> str:
        from raptix.core.dispatch_context import active_dispatch

        context = active_dispatch.get()
        if context is not None and context.objective_id:
            return context.objective_id
        state = getattr(request, "state", None) or {}
        return str(state.get("active_objective_id") or "unscoped")

    def _key(self, request: Any) -> tuple[str, str]:
        config = getattr(getattr(request, "runtime", None), "config", None) or {}
        scope = (config.get("configurable") or {}).get("thread_id")
        if not scope:
            state = getattr(request, "state", None) or {}
            scope = state.get("engagement_name") or state.get("kg_engagement") or "default"
        return str(scope), self._objective(request)

    def _revision(self, request: Any) -> int:
        if self._backend is None:
            return 0
        try:
            from raptix.orchestration.mission.task_state import (
                read_task_state,
                scoped_task_backend,
            )

            runtime = getattr(request, "runtime", None) or request
            backend = scoped_task_backend(self._backend, runtime)
            if backend is None:
                return 0
            state = read_task_state(backend, self._objective(request)).state
            return state.state_revision if state is not None else 0
        except Exception as exc:  # noqa: BLE001 — a progress signal is best-effort
            log.debug("progress revision unavailable: %s", type(exc).__name__)
            return 0

    def _observe(self, request: Any, result: Any) -> None:
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
        entry = (action, self._revision(request), _result_hash(result), _technique(name, args))
        key = self._key(request)
        with self._lock:
            window = self._progress.get(key)
            if window is None:
                if len(self._progress) >= _PROGRESS_MAX_KEYS:
                    self._progress.pop(next(iter(self._progress)), None)
                window = deque(maxlen=_STALL_WINDOW)
                self._progress[key] = window
            window.append(entry)

    def _progress_text(self, request: Any) -> str:
        if not progress_observe_enabled():
            return ""
        key = self._key(request)
        with self._lock:
            window = self._progress.get(key)
            if window is None or len(window) < _STALL_WINDOW:
                return ""
            if any(entry != window[-1] for entry in window):
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
        text = self._progress_text(request)
        return self._append_system(request, text) if text else request
