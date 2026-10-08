"""Record / replay layer for deterministic engagement re-execution.

Why this exists
---------------
Raptix's benchmark numbers (XBOW 98.08%) are not currently reproducible
on demand. A run that hit 102/104 today may hit 99/104 tomorrow because the
underlying LLM is non-deterministic and tool outputs against live targets
drift. Without a record/replay layer you cannot:

- Bisect a regression (was it the prompt change or the model change?).
- Certify a release against a fixed transcript.
- Test middleware modifications without paying the LLM cost for every run.
- Reproduce a flaky benchmark failure long enough to debug it.

Design
------
**Recording mode** wraps both ``wrap_model_call`` and ``wrap_tool_call`` to
capture (request_hash, response) pairs into a single append-only JSONL file:

  - ``model_call`` entries carry: prompt-hash, model id, response content,
    tool calls emitted, token usage.
  - ``tool_call`` entries carry: tool name, args-hash, ToolMessage content.

Hashing is over a *canonical* serialization of the request (sorted keys,
no timestamps, no run IDs) so the same prompt at different wall-clock
times hashes identically.

**Replay mode** consumes that JSONL, hashes the incoming request the same
way, and serves the recorded response without invoking the LLM or running
the tool. If a request is encountered whose hash isn't in the record, the
mode raises ``ReplayMismatchError`` — the caller decides whether to fall
through to a real LLM call (``strict=False``) or fail loudly (``strict=True``).

File format
-----------
JSONL, one event per line::

    {"kind":"model_call","seq":42,"req_hash":"sha256:...","model":"claude-opus-4-7",
     "request":{...canonical...},"response":{...content...},"usage":{...},
     "agent":"recon","engagement":"lab-x","workspace":"/workspace/lab-x",
     "objective_id":"OBJ-3","ts":"...Z","dur_ms":4120}
    {"kind":"tool_call","seq":43,"req_hash":"sha256:...","tool":"bash",
     "request":{...},"response":{...ToolMessage...}}

The ``seq`` field is the global execution order — useful for diffing two
runs that diverged mid-execution. Sinks are shared per resolved path, so
several agents recording to one file interleave under a single ``seq``.

Every entry additionally carries an **observability envelope** — ``agent``,
``engagement``, ``workspace``, ``objective_id``, ``ts`` (ISO-8601 UTC),
``dur_ms`` — which the replayer ignores (it keys on ``kind``/``req_hash``
only). A failed model/tool call is recorded as a
``{"type": "error", ...}`` response before the exception is re-raised, so
capture loss is visible instead of a silent gap; the replayer skips error
entries (a failed call is not replayable).

What is NOT recorded
--------------------
- Wall-clock data inside the *canonical hash* (the envelope's ``ts``/
  ``dur_ms`` sit outside the hashed request, so replay is unaffected).
- Random.* seeds — agents should not consume randomness; if they do that's
  a separate bug to fix.
- Sandbox internal state (jobs registry, tmux session IDs) — these are
  re-derived deterministically from the recorded tool messages.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, ClassVar

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelResponse
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command
from typing_extensions import override

from raptix.orchestration.mission.objective_context import ObjectiveContextState

log = logging.getLogger(__name__)


class ReplayMismatchError(RuntimeError):
    """Raised when replay encounters a request not present in the record."""

    def __init__(self, kind: str, req_hash: str, *, available_hashes: int) -> None:
        self.kind = kind
        self.req_hash = req_hash
        self.available_hashes = available_hashes
        super().__init__(
            f"replay miss: kind={kind} req_hash={req_hash[:16]}… "
            f"({available_hashes} hashes recorded)"
        )


def _canonicalize(obj: Any) -> Any:
    """Drop fields that vary across otherwise-identical runs (timestamps, run IDs)."""
    if isinstance(obj, dict):
        out = {}
        for k, v in sorted(obj.items()):
            if k in {"id", "run_id", "thread_id", "timestamp", "created_at"}:
                continue
            out[k] = _canonicalize(v)
        return out
    if isinstance(obj, list):
        return [_canonicalize(v) for v in obj]
    return obj


def _hash_request(payload: Any) -> str:
    canonical = _canonicalize(payload)
    encoded = json.dumps(canonical, sort_keys=True, default=str).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _serialize_messages(messages: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for msg in messages or []:
        entry: dict[str, Any] = {
            "type": getattr(msg, "type", msg.__class__.__name__),
            "content": getattr(msg, "content", ""),
        }
        for attr in ("name", "tool_call_id", "tool_calls", "additional_kwargs"):
            if hasattr(msg, attr):
                value = getattr(msg, attr)
                if value:
                    entry[attr] = value
        out.append(entry)
    return out


def _serialize_model_request(request: Any) -> dict[str, Any]:
    system = request.system_message
    model = getattr(request, "model", None)
    return {
        "model": getattr(model, "model_name", None) or getattr(model, "name", "") or "",
        "system": getattr(system, "content", "") if system is not None else "",
        "messages": _serialize_messages(getattr(request, "messages", []) or []),
        "tools": [getattr(t, "name", "") for t in (getattr(request, "tools", []) or [])],
    }


def _serialize_tool_request(request: Any) -> dict[str, Any]:
    tool = getattr(request, "tool", None)
    tc = getattr(request, "tool_call", None) or {}
    args = tc.get("args", {}) if isinstance(tc, dict) else {}
    return {
        "tool": getattr(tool, "name", "") if tool else "",
        "args": args or {},
    }


def _normalize_usage(message: Any) -> tuple[dict[str, Any] | None, str]:
    """Return ``(usage, source)`` with an explicit provenance tag.

    Providers disagree on where token counts live. Rather than silently
    dropping usage when the preferred slot is empty, fall back through the
    known shapes; when nothing is found report ``(None, "absent")`` so an
    analyst can distinguish "provider sent nothing" from "recorder bug".
    """
    um = getattr(message, "usage_metadata", None)
    if isinstance(um, dict) and um:
        return um, "usage_metadata"
    rm = getattr(message, "response_metadata", None)
    if isinstance(rm, dict):
        for key in ("token_usage", "usage"):
            val = rm.get(key)
            if isinstance(val, dict) and val:
                return val, "response_metadata"
    ak = getattr(message, "additional_kwargs", None)
    if isinstance(ak, dict):
        val = ak.get("usage")
        if isinstance(val, dict) and val:
            return val, "additional_kwargs"
    return None, "absent"


def _serialize_ai_response(message: Any) -> dict[str, Any]:
    if isinstance(message, ModelResponse):
        messages = message.result
        serialized = _serialize_ai_response(
            next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)
        )
        serialized["messages"] = [
            _serialize_ai_response(m) if isinstance(m, AIMessage) else _serialize_tool_response(m)
            for m in messages
        ]
        serialized["structured_response"] = message.structured_response
        return serialized
    usage, usage_source = _normalize_usage(message)
    return {
        "type": getattr(message, "type", "ai"),
        "content": getattr(message, "content", ""),
        "tool_calls": getattr(message, "tool_calls", []) or [],
        "usage_metadata": getattr(message, "usage_metadata", {}) or {},
        "usage": usage,
        "usage_source": usage_source,
        "additional_kwargs": getattr(message, "additional_kwargs", {}) or {},
    }


def _serialize_tool_response(message: Any) -> dict[str, Any]:
    return {
        "type": "tool",
        "content": getattr(message, "content", ""),
        "tool_call_id": getattr(message, "tool_call_id", ""),
        "name": getattr(message, "name", ""),
        "status": getattr(message, "status", ""),
        "artifact": getattr(message, "artifact", None),
    }


def _serialize_command_response(command: Any) -> dict[str, Any]:
    """Serialize a graph-control ``Command`` (the ``task`` tool's return shape).

    The sub-agent report lives in ``update["messages"]``; the previous
    ``{"type": "command"}`` stub destroyed it.
    """
    update = getattr(command, "update", None)
    if not isinstance(update, dict):
        update = {}
    messages = update.get("messages")
    return {
        "type": "command",
        "update_keys": sorted(update.keys()),
        "messages": _serialize_messages(messages if isinstance(messages, list) else []),
        "dispatch_ledger": update.get("dispatch_ledger"),
    }


def _serialize_error_response(exc: BaseException) -> dict[str, Any]:
    """Observability-only shape for a failed call; never replayable."""
    return {
        "type": "error",
        "error": type(exc).__name__,
        "detail": str(exc)[:2000],
    }


class _Sink:
    """Append-only JSONL writer, shared per resolved path within a process.

    - One writer per path: two ``RecordingMiddleware`` instances recording
      to the same file join the same sink, so ``seq`` is the run's global
      execution order (per process) instead of colliding per instance.
    - Poisoned on first write failure: capture must never break a live run
      (an exception escaping into ToolNode would replace the real tool
      result with an error ToolMessage). After one failed write the sink
      short-circuits every later write and logs exactly once.
    - Flush-per-write; no fsync (advisory channel). At most the in-flight
      line is lost; the fd is released at process exit.
    """

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path
        # Continue the seq of an existing file so a second process (or a
        # re-opened sink) does not restart the ordering from zero.
        self._seq = self._count_lines(path)
        self._fh = path.open("a", encoding="utf-8")
        self._poisoned = False

    @staticmethod
    def _count_lines(path: Path) -> int:
        if not path.exists():
            return 0
        total = 0
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                total += chunk.count(b"\n")
        return total

    @property
    def path(self) -> Path:
        return self._path

    @property
    def poisoned(self) -> bool:
        return self._poisoned

    @property
    def closed(self) -> bool:
        return self._fh.closed

    def write(self, entry: dict[str, Any]) -> bool:
        """Append one entry. Never raises; returns False once poisoned."""
        if self._poisoned:
            return False
        entry["seq"] = self._seq
        self._seq += 1
        try:
            self._fh.write(json.dumps(entry, default=str) + "\n")
            self._fh.flush()
        except Exception:  # noqa: BLE001 - capture must never break the run
            self._poisoned = True
            log.warning(
                "record sink %s failed; capture disabled for the rest of "
                "this run (live tool results are returned unchanged)",
                self._path,
                exc_info=True,
            )
            return False
        return True

    def close(self) -> None:
        try:
            self._fh.close()
        except Exception:  # noqa: BLE001
            log.warning("failed to close record sink at %s", self._path, exc_info=True)


_SINKS: dict[str, "_Sink"] = {}


def open_record(path: str | Path) -> _Sink:
    """Open — or join — the shared append-only record sink for ``path``.

    The sink is opened eagerly: an unusable path fails HERE with the real
    ``OSError`` (which ``_make_record`` re-raises with the env var named),
    and the first open per path logs the resolved location so capture loss
    is detectable at startup rather than discovered from an empty file.
    """
    resolved = Path(path).expanduser().resolve()
    key = str(resolved)
    existing = _SINKS.get(key)
    if existing is not None and not existing.closed:
        return existing
    sink = _Sink(resolved)
    _SINKS[key] = sink
    log.info("recording enabled → %s", resolved)
    return sink


class _Replay:
    """Read-only JSONL replayer indexed by req_hash."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._model: dict[str, dict[str, Any]] = {}
        self._tools: dict[str, dict[str, Any]] = {}
        if not path.exists():
            raise FileNotFoundError(f"replay file not found: {path}")
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    log.warning("malformed replay line skipped in %s", path)
                    continue
                kind = entry.get("kind")
                req_hash = entry.get("req_hash")
                if not kind or not req_hash:
                    continue
                response = entry.get("response")
                if isinstance(response, dict) and response.get("type") == "error":
                    # A failed call is observability-only; replaying it as an
                    # empty message would silently corrupt a re-run.
                    continue
                if kind == "model_call":
                    self._model[req_hash] = entry
                elif kind == "tool_call":
                    self._tools[req_hash] = entry

    def lookup_model(self, req_hash: str) -> dict[str, Any] | None:
        return self._model.get(req_hash)

    def lookup_tool(self, req_hash: str) -> dict[str, Any] | None:
        return self._tools.get(req_hash)

    @property
    def stats(self) -> dict[str, int]:
        return {"model_calls": len(self._model), "tool_calls": len(self._tools)}


def open_replay(path: str | Path) -> _Replay:
    """Open ``path`` for replay lookups."""
    return _Replay(Path(path))


class RecordingMiddleware(AgentMiddleware):
    """Capture every model + tool round-trip to a JSONL record file.

    Sinks are shared per resolved path (see :func:`open_record`), so several
    agents recording to one file interleave entries under a single global
    ``seq`` per process.

    Place this middleware *closest to the inner runtime* (last in the stack)
    so it observes the request/response shapes that actually hit the LLM
    after all other middleware has had its chance to mutate them.

    Every entry carries an observability envelope — ``agent`` (role, with a
    ``runtime.agent_name`` fallback), ``engagement``, ``workspace``,
    ``objective_id``, ``ts``, ``dur_ms`` — that the replayer ignores. A
    failed call is recorded as an ``{"type": "error"}`` response before the
    exception is re-raised (previously the gap was silent); sink write
    failures poison the sink instead of propagating, so capture can never
    replace a live tool result with an error ToolMessage.
    """

    state_schema = ObjectiveContextState

    def __init__(self, *, path: str | Path | None = None, role: str = "") -> None:
        super().__init__()
        self._role = role or ""
        record_path = path or os.environ.get("RAPTIX_RUNTIME__RECORD_PATH", "")
        self._sink: _Sink | None = open_record(Path(record_path)) if record_path else None

    def _envelope(self, request: Any, req_hash: str, dur_ms: int) -> dict[str, Any]:
        """Observability metadata; the replayer reads only kind/req_hash."""
        state = getattr(request, "state", None) or {}
        get = state.get if hasattr(state, "get") else (lambda _k, _d=None: None)
        agent = self._role or ""
        if not agent:
            runtime = getattr(request, "runtime", None)
            agent = getattr(runtime, "agent_name", "") or ""
        return {
            "agent": agent,
            "engagement": str(
                get("engagement_name")
                or get("engagement_id")
                or os.environ.get("RAPTIX_ENGAGEMENT_ID", "")
            ),
            "workspace": str(get("workspace_path") or os.environ.get("RAPTIX_WORKSPACE_PATH", "")),
            "objective_id": str(get("active_objective_id") or ""),
            "ts": datetime.now(timezone.utc).isoformat(),
            "dur_ms": dur_ms,
            "req_hash": req_hash,
        }

    def _record(self, request: Any, entry: dict[str, Any], dur_ms: int) -> None:
        if self._sink is None:
            return
        envelope = self._envelope(request, entry["req_hash"], dur_ms)
        if "objective_id" in entry:
            envelope["objective_id"] = entry["objective_id"]
        entry.update(envelope)
        self._sink.write(entry)

    @override
    def wrap_model_call(self, request, handler):
        if self._sink is None:
            return handler(request)
        req_dict = _serialize_model_request(request)
        req_hash = _hash_request(req_dict)
        start = time.monotonic()
        try:
            response = handler(request)
        except Exception as exc:
            self._record(
                request,
                {
                    "kind": "model_call",
                    "req_hash": req_hash,
                    "request": req_dict,
                    "response": _serialize_error_response(exc),
                },
                int((time.monotonic() - start) * 1000),
            )
            raise
        self._record(
            request,
            {
                "kind": "model_call",
                "req_hash": req_hash,
                "request": req_dict,
                "response": _serialize_ai_response(response),
            },
            int((time.monotonic() - start) * 1000),
        )
        return response

    @override
    async def awrap_model_call(self, request, handler):
        if self._sink is None:
            return await handler(request)
        req_dict = _serialize_model_request(request)
        req_hash = _hash_request(req_dict)
        start = time.monotonic()
        try:
            response = await handler(request)
        except Exception as exc:
            self._record(
                request,
                {
                    "kind": "model_call",
                    "req_hash": req_hash,
                    "request": req_dict,
                    "response": _serialize_error_response(exc),
                },
                int((time.monotonic() - start) * 1000),
            )
            raise
        self._record(
            request,
            {
                "kind": "model_call",
                "req_hash": req_hash,
                "request": req_dict,
                "response": _serialize_ai_response(response),
            },
            int((time.monotonic() - start) * 1000),
        )
        return response

    def _tool_entry(self, req_dict: dict[str, Any], req_hash: str, response: Any) -> dict[str, Any]:
        if isinstance(response, ToolMessage):
            serialized = _serialize_tool_response(response)
        elif isinstance(response, Command):
            serialized = _serialize_command_response(response)
        else:
            # Unknown non-ToolMessage control object: keep the legacy stub.
            serialized = {"type": "command"}
        entry = {
            "kind": "tool_call",
            "req_hash": req_hash,
            "request": req_dict,
            "response": serialized,
        }
        if req_dict["tool"] == "task":
            update = response.update if isinstance(response, Command) else None
            entry["objective_id"] = (
                update.get("active_objective_id", "") if isinstance(update, dict) else ""
            )
        return entry

    @override
    def wrap_tool_call(self, request, handler):
        if self._sink is None:
            return handler(request)
        req_dict = _serialize_tool_request(request)
        req_hash = _hash_request(req_dict)
        start = time.monotonic()
        try:
            response = handler(request)
        except Exception as exc:
            entry = self._tool_entry(req_dict, req_hash, None)
            entry["response"] = _serialize_error_response(exc)
            self._record(request, entry, int((time.monotonic() - start) * 1000))
            raise
        self._record(
            request,
            self._tool_entry(req_dict, req_hash, response),
            int((time.monotonic() - start) * 1000),
        )
        return response

    @override
    async def awrap_tool_call(self, request, handler):
        if self._sink is None:
            return await handler(request)
        req_dict = _serialize_tool_request(request)
        req_hash = _hash_request(req_dict)
        start = time.monotonic()
        try:
            response = await handler(request)
        except Exception as exc:
            entry = self._tool_entry(req_dict, req_hash, None)
            entry["response"] = _serialize_error_response(exc)
            self._record(request, entry, int((time.monotonic() - start) * 1000))
            raise
        self._record(
            request,
            self._tool_entry(req_dict, req_hash, response),
            int((time.monotonic() - start) * 1000),
        )
        return response


class ReplayMiddleware(AgentMiddleware):
    """Serve recorded responses for matching model/tool requests; bypass the runtime.

    Construct with the path to a JSONL produced by :class:`RecordingMiddleware`
    and a strictness flag:

    - ``strict=True`` (default): a request whose hash is not in the record
      raises :class:`ReplayMismatchError`. Use for CI / certification runs.
    - ``strict=False``: misses fall through to the real handler. Use for
      "partial replay" — re-run with deltas; freshly-needed answers hit
      the live LLM and the replay stays current for the rest.
    """

    _ATTR_RESPONSE: ClassVar[str] = "response"

    def __init__(self, *, path: str | Path | None = None, strict: bool = True) -> None:
        super().__init__()
        replay_path = path or os.environ.get("RAPTIX_RUNTIME__REPLAY_PATH", "")
        if not replay_path:
            self._replay: _Replay | None = None
        else:
            self._replay = open_replay(Path(replay_path))
        self._strict = strict

    def _model_response(self, entry: dict[str, Any]) -> Any:
        payload = entry.get(self._ATTR_RESPONSE) or {}
        return AIMessage(
            content=payload.get("content", ""),
            tool_calls=payload.get("tool_calls", []) or [],
            additional_kwargs=payload.get("additional_kwargs") or {},
            usage_metadata=payload.get("usage_metadata") or None,
        )

    def _tool_response(self, entry: dict[str, Any]) -> Any:
        payload = entry.get(self._ATTR_RESPONSE) or {}
        return ToolMessage(
            content=payload.get("content", ""),
            tool_call_id=payload.get("tool_call_id", "") or "",
            name=payload.get("name", "") or "",
            status=payload.get("status", "success") or "success",
            artifact=payload.get("artifact"),
        )

    @override
    def wrap_model_call(self, request, handler):
        if self._replay is None:
            return handler(request)
        req_dict = _serialize_model_request(request)
        req_hash = _hash_request(req_dict)
        entry = self._replay.lookup_model(req_hash)
        if entry is None:
            if self._strict:
                raise ReplayMismatchError(
                    "model_call",
                    req_hash,
                    available_hashes=self._replay.stats["model_calls"],
                )
            return handler(request)
        return self._model_response(entry)

    @override
    async def awrap_model_call(self, request, handler):
        if self._replay is None:
            return await handler(request)
        req_dict = _serialize_model_request(request)
        req_hash = _hash_request(req_dict)
        entry = self._replay.lookup_model(req_hash)
        if entry is None:
            if self._strict:
                raise ReplayMismatchError(
                    "model_call",
                    req_hash,
                    available_hashes=self._replay.stats["model_calls"],
                )
            return await handler(request)
        return self._model_response(entry)

    @override
    def wrap_tool_call(self, request, handler):
        if self._replay is None:
            return handler(request)
        req_dict = _serialize_tool_request(request)
        req_hash = _hash_request(req_dict)
        entry = self._replay.lookup_tool(req_hash)
        if entry is None:
            if self._strict:
                raise ReplayMismatchError(
                    "tool_call",
                    req_hash,
                    available_hashes=self._replay.stats["tool_calls"],
                )
            return handler(request)
        return self._tool_response(entry)

    @override
    async def awrap_tool_call(self, request, handler):
        if self._replay is None:
            return await handler(request)
        req_dict = _serialize_tool_request(request)
        req_hash = _hash_request(req_dict)
        entry = self._replay.lookup_tool(req_hash)
        if entry is None:
            if self._strict:
                raise ReplayMismatchError(
                    "tool_call",
                    req_hash,
                    available_hashes=self._replay.stats["tool_calls"],
                )
            return await handler(request)
        return self._tool_response(entry)
