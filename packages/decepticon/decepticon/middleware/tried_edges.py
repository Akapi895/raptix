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
from typing import Any, cast

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage, ToolMessage

from decepticon.middleware.kg_internal.store import KGStore

log = logging.getLogger(__name__)
_MAX_ENTRIES = 20
_MAX_SECONDS = 4
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
    return os.environ.get("DECEPTICON_KG_TRIED_EDGES", "0").strip().lower() in {"1", "true", "yes"}


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

    def __init__(self, *, store: KGStore, role: str) -> None:
        super().__init__()
        self._store = store
        self._role = role
        self._slots = threading.BoundedSemaphore(value=2)

    def _bounded_call(self, action: Any, *args: Any, **kwargs: Any) -> Any:
        if not self._slots.acquire(blocking=False):
            return []
        try:
            return action(*args, **kwargs)
        finally:
            self._slots.release()

    async def awrap_tool_call(self, request: Any, handler: Any) -> Any:
        result = await handler(request)
        if _enabled():
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(self._bounded_call, self._record, request, result),
                    timeout=_MAX_SECONDS,
                )
            except Exception as exc:
                log.debug("tried-edge recording skipped: %s", exc)
        return result

    def _record(self, request: Any, result: Any) -> None:
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

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        if not _enabled():
            return await handler(request)
        state = request.state or {}
        engagement = state.get("engagement_name") or state.get("kg_engagement")
        if not isinstance(engagement, str) or not engagement:
            return await handler(request)
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
                content = (
                    [*request.system_message.content_blocks]
                    if request.system_message is not None
                    else []
                )
                content.append({"type": "text", "text": "\n\n" + text})
                request = request.override(
                    system_message=SystemMessage(
                        content=cast("list[str | dict[str, str]]", content)
                    )
                )
        except Exception as exc:
            log.debug("tried-edge context skipped: %s", exc)
        return await handler(request)
