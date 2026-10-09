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
import re
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, ClassVar

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelResponse
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Command
from typing_extensions import override

from raptix.core.dispatch_context import active_dispatch
from raptix.orchestration.mission.objective_context import ObjectiveContextState
from raptix.runtime.call_context import active_call, call_scope, identity, instrument_model

log = logging.getLogger(__name__)

_RAW_USAGE_ENV = "RAPTIX_LLM__LOG_RAW_USAGE"
_RECORD_LEVEL_ENV = "RAPTIX_RUNTIME__RECORD_LEVEL"
_RECORD_LEVELS = frozenset({"raw", "redacted"})


class NonReplayableRecord(RuntimeError):
    """Raised when replay is attempted against a record marked non-replayable."""


class RecordModeError(ValueError):
    """An append would mix raw and redacted recording modes."""


class RecordExportError(ValueError):
    """A sanitized export would overwrite its raw source."""


def raw_usage_logging_enabled() -> bool:
    return os.environ.get(_RAW_USAGE_ENV, "0").strip().lower() in {"1", "true", "yes"}


def record_level() -> str:
    """Resolved record level; invalid values fail loudly, naming the env var."""
    level = os.environ.get(_RECORD_LEVEL_ENV, "raw").strip().lower() or "raw"
    if level not in _RECORD_LEVELS:
        raise RuntimeError(f"{_RECORD_LEVEL_ENV}={level!r} is not one of {sorted(_RECORD_LEVELS)}.")
    return level


def _served_model(source: Any) -> str:
    """The provider/model the route actually served, if the response exposes it."""
    source = getattr(source, "model_response", source)
    message = source
    if isinstance(source, ModelResponse):
        message = next((m for m in reversed(source.result) if isinstance(m, AIMessage)), None)
    metadata = getattr(message, "response_metadata", None) or {}
    if not isinstance(metadata, dict):
        return ""
    return str(metadata.get("model_name") or metadata.get("model") or "")[:128]


def _raw_usage(source: Any) -> dict[str, Any]:
    """Usage-bearing metadata for the raw-usage debug passthrough (never params)."""
    source = getattr(source, "model_response", source)
    message = source
    if isinstance(source, ModelResponse):
        message = next((m for m in reversed(source.result) if isinstance(m, AIMessage)), None)
    usage = getattr(message, "usage_metadata", None)
    metadata = getattr(message, "response_metadata", None)
    raw: dict[str, Any] = {}
    if isinstance(usage, dict) and usage:
        raw["usage_metadata"] = _usage_numbers(usage)
    if isinstance(metadata, dict):
        for key in ("token_usage", "usage", "model_name", "model"):
            value = metadata.get(key)
            if isinstance(value, dict) and value:
                raw[key] = _usage_numbers(value)
    details = raw.get("usage_metadata")
    if isinstance(details, dict) and details.get("input_token_details") is not None:
        raw["input_token_details"] = details["input_token_details"]
    return raw


def _usage_numbers(usage: dict) -> dict[str, Any]:
    counts = {
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
        "cached_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
        "reasoning_tokens",
        "cache_creation_tokens",
        "cache_read",
        "cache_creation",
        "audio",
        "text",
        "reasoning",
    }
    details = {
        "prompt_tokens_details",
        "completion_tokens_details",
        "input_token_details",
        "output_token_details",
    }
    return {
        key: (value if key in counts else _usage_numbers(value))
        for key, value in usage.items()
        if (
            key in counts
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
            and value >= 0
        )
        or (key in details and isinstance(value, dict))
    }


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
    message = getattr(message, "model_response", message)
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


def _redact_bearer(match: re.Match[str]) -> str:
    return f"{match.group(1)}[REDACTED:bearer]"


def _redact_assignment(match: re.Match[str]) -> str:
    return f"{match.group(1)}{match.group(2)}[REDACTED:credential]"


_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "private_key",
        re.compile(
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
            re.DOTALL,
        ),
    ),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")),
    ("bearer", re.compile(r"(?i)\b(bearer\s+)([A-Za-z0-9._-]{8,})")),
    (
        "api_key",
        re.compile(
            r"\b(sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
            r"|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b"
        ),
    ),
    (
        "credential",
        re.compile(
            r"(?i)\b(password|passwd|secret|token|api[_-]?key|access[_-]?key)"
            r"(\s*[:=]\s*)(?!\[REDACTED)[^\s\"',}]{4,}"
        ),
    ),
)


def _redact_string(value: str) -> str:
    if value.lstrip().startswith(("{", "[")):
        try:
            parsed = json.loads(value)
        except (ValueError, RecursionError):
            parsed = None
        if isinstance(parsed, (dict, list)):
            return json.dumps(sanitize_entry(parsed), ensure_ascii=False, sort_keys=True)
    redacted = value
    for kind, pattern in _SECRET_PATTERNS:
        if kind == "bearer":
            redacted = pattern.sub(_redact_bearer, redacted)
        elif kind == "credential":
            redacted = pattern.sub(_redact_assignment, redacted)
        else:
            redacted = pattern.sub(f"[REDACTED:{kind}]", redacted)
    redacted = re.sub(
        r"(?i)(\b(?:bearer|basic)\s+)([^\s\"']+)",
        lambda m: (
            m.group(0)
            if m.group(2).startswith("[REDACTED")
            else m.group(1) + "[REDACTED:authorization]"
        ),
        redacted,
    )
    redacted = re.sub(
        r"([a-zA-Z][a-zA-Z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@", r"\1[REDACTED:credentials]@", redacted
    )
    return re.sub(
        r"""(?i)((?:["']?\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client_secret|refresh_token)["']?)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}{]+)""",
        lambda m: (
            m.group(0) if "[REDACTED:" in m.group(2) else m.group(1) + "[REDACTED:credential]"
        ),
        redacted,
    )


def sanitize_entry(value: Any, *, _depth: int = 0) -> Any:
    """Deterministically redact secret-shaped strings across an entry (ADR-0060)."""
    if _depth > 32:
        return "[REDACTED:depth]"
    if isinstance(value, str):
        return _redact_string(value)
    if isinstance(value, dict):
        sensitive = {
            "password",
            "passwd",
            "pwd",
            "secret",
            "token",
            "api_key",
            "apikey",
            "access_token",
            "refresh_token",
            "client_secret",
            "private_key",
            "authorization",
            "proxy_authorization",
            "cookie",
            "set_cookie",
            "credentials",
        }
        return {
            key: (
                "[REDACTED:credential]"
                if str(key).lower().replace("-", "_") in sensitive
                or str(key).lower().endswith(("_password", "_secret", "_token", "_api_key"))
                else sanitize_entry(item, _depth=_depth + 1)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_entry(item, _depth=_depth + 1) for item in value]
    return value


def export_sanitized(src: str | Path, dst: str | Path) -> int:
    """Write a share-safe copy of a raw record; mark it non-replayable.

    Returns the number of sanitized entries written. Malformed lines are
    dropped (a shareable artifact must not fail on one bad line).
    """
    source = Path(src)
    target = Path(dst)
    if source.resolve() == target.resolve() or (
        target.exists() and os.path.samefile(source, target)
    ):
        raise RecordExportError("sanitized export must not overwrite its raw source")
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    temporary = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", newline="\n", dir=target.parent, delete=False
    )
    with source.open("r", encoding="utf-8") as reader, temporary as writer:
        writer.write(
            json.dumps(
                {
                    "kind": "record_header",
                    "record_level": "redacted",
                    "replayable": False,
                    "source": _redact_string(source.name),
                }
            )
            + "\n"
        )
        for line in reader:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict):
                continue
            writer.write(json.dumps(sanitize_entry(entry), default=str) + "\n")
            written += 1
    os.replace(temporary.name, target)
    return written


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

    def __init__(self, path: Path, *, redacted: bool = False) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path
        self.redacted = redacted
        if path.exists() and path.stat().st_size:
            with path.open(encoding="utf-8") as prior:
                headers = []
                for line in prior:
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(row, dict) and row.get("kind") == "record_header":
                        headers.append(row)
            was_redacted = any(h.get("replayable") is False for h in headers)
            if was_redacted != redacted:
                raise RecordModeError(
                    "RAPTIX_RUNTIME__RECORD_LEVEL cannot change on an existing record"
                )
        # Continue the seq of an existing file so a second process (or a
        # re-opened sink) does not restart the ordering from zero.
        self._seq = self._count_lines(path)
        self._fh = path.open("a", encoding="utf-8")
        self._poisoned = False
        if redacted and self._seq == 0:
            # A redacted record is not replayable; say so in the header so
            # open_replay refuses it rather than silently mismatching.
            self.write(
                {
                    "kind": "record_header",
                    "record_level": "redacted",
                    "replayable": False,
                }
            )

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
        entry = sanitize_entry(entry) if self.redacted else dict(entry)
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
        if existing.redacted != (record_level() == "redacted"):
            raise RecordModeError("record mode cannot change while a sink is open")
        return existing
    sink = _Sink(resolved, redacted=record_level() == "redacted")
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
                if not isinstance(entry, dict):
                    continue
                if entry.get("kind") == "record_header" and entry.get("replayable") is False:
                    raise NonReplayableRecord(f"{path} is marked non-replayable")
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


def _record_attempts(sink: _Sink) -> None:
    frame = active_call.get()
    if frame is None:
        return
    for attempt in frame.attempts:
        entry = {
            **identity(),
            **{k: v for k, v in attempt.items() if k != "started"},
            "kind": "upstream_attempt",
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        sink.write(entry)
    frame.attempts.clear()


def summary_call_recording_enabled() -> bool:
    return bool((os.environ.get("RAPTIX_RUNTIME__RECORD_PATH", "") or "").strip())


class SummaryCallRecorder:
    """Duck-typed model proxy that records summary-model calls separately.

    The summarization helper calls ``model.invoke``/``ainvoke`` directly,
    bypassing the RECORD middleware slot, so wrapping the summary model is the
    only point that sees those calls. Every other attribute delegates to the
    real model so token-counter and profile access keep working.
    """

    def __init__(self, model: Any, *, role: str = "") -> None:
        self._model = model
        self._role = role
        self._request = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._model, name)

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        with call_scope("summary_call", self._request):
            start = time.monotonic()
            instrument_model(self._model)
            try:
                response = self._model.invoke(input, config=config, **kwargs)
            except Exception as exc:
                _record_summary_call(
                    self._role, input, exc, int((time.monotonic() - start) * 1000), self._request
                )
                raise
            _record_summary_call(
                self._role, input, response, int((time.monotonic() - start) * 1000), self._request
            )
            return response

    async def ainvoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        with call_scope("summary_call", self._request):
            start = time.monotonic()
            instrument_model(self._model)
            try:
                response = await self._model.ainvoke(input, config=config, **kwargs)
            except Exception as exc:
                _record_summary_call(
                    self._role, input, exc, int((time.monotonic() - start) * 1000), self._request
                )
                raise
            _record_summary_call(
                self._role, input, response, int((time.monotonic() - start) * 1000), self._request
            )
            return response


def wrap_summary_model(model: Any, *, role: str = "", request: Any = None) -> Any:
    """Wrap a summary model for separate telemetry, or return it unchanged."""
    if not summary_call_recording_enabled():
        return model
    wrapped = SummaryCallRecorder(
        model._model if isinstance(model, SummaryCallRecorder) else model,
        role=role or getattr(model, "_role", ""),
    )
    wrapped._request = request
    return wrapped


def _record_summary_call(
    role: str, prompt: Any, response: Any, dur_ms: int, request: Any = None
) -> None:
    try:
        record_path = (os.environ.get("RAPTIX_RUNTIME__RECORD_PATH", "") or "").strip()
        if not record_path:
            return
        entry: dict[str, Any] = {
            "kind": "summary_call",
            "req_hash": _hash_request({"summary_prompt": str(prompt)}),
            "agent": role,
            "ts": datetime.now(timezone.utc).isoformat(),
            "dur_ms": dur_ms,
            "request": {"role": role},
            "response": (
                _serialize_error_response(response)
                if isinstance(response, Exception)
                else _serialize_ai_response(response)
                if not isinstance(response, str)
                else {"content": response}
            ),
        }
        entry.update(identity())
        state = getattr(request, "state", {}) or {}
        dispatch = active_dispatch.get()
        entry["objective_id"] = (dispatch.objective_id if dispatch else None) or state.get(
            "active_objective_id"
        )
        served = _served_model(response)
        if served:
            entry["served_model"] = served
        if raw_usage_logging_enabled():
            entry["raw_usage"] = _raw_usage(response)
        if record_level() == "redacted":
            entry = sanitize_entry(entry)
        open_record(Path(record_path)).write(entry)
        _record_attempts(open_record(Path(record_path)))
    except Exception as exc:  # noqa: BLE001 — telemetry never blocks summarization
        log.debug("summary-call recording skipped: %s", type(exc).__name__)


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
        self._redacted = record_level() == "redacted"
        record_path = path or os.environ.get("RAPTIX_RUNTIME__RECORD_PATH", "")
        self._sink: _Sink | None = open_record(Path(record_path)) if record_path else None
        self._tool_parents: dict[tuple[str, str], str] = {}

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
            **identity(),
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
        if self._redacted:
            entry = sanitize_entry(entry)
        self._sink.write(entry)
        _record_attempts(self._sink)

    @contextmanager
    def _scope(self, kind: str, request: Any):
        parent = None
        scope = self._scope_key(request)
        tool_call = getattr(request, "tool_call", {}) or {}
        if kind == "tool_call":
            parent = self._tool_parents.pop((scope, str(tool_call.get("id"))), None)
        with call_scope(kind, request, parent) as frame:
            instrument_model(getattr(request, "model", None))
            yield frame

    @staticmethod
    def _scope_key(request: Any) -> str:
        state = getattr(request, "state", {}) or {}
        from langgraph.config import get_config

        try:
            config = get_config()
        except RuntimeError:
            config = getattr(getattr(request, "runtime", None), "config", None) or {}
        dispatch = active_dispatch.get()
        return json.dumps(
            [
                state.get("workspace_path"),
                state.get("engagement_name"),
                (config.get("configurable") or {}).get("thread_id"),
                dispatch.lease_token if dispatch else None,
            ]
        )

    def _model_entry(
        self, req_dict: dict[str, Any], req_hash: str, response: Any, request: Any = None
    ) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "kind": "model_call",
            "req_hash": req_hash,
            "request": req_dict,
            "response": _serialize_ai_response(response),
        }
        served = _served_model(response)
        if served:
            entry["served_model"] = served
        if raw_usage_logging_enabled():
            entry["raw_usage"] = _raw_usage(response)
        frame = active_call.get()
        unwrapped = getattr(response, "model_response", response)
        messages = getattr(unwrapped, "result", [unwrapped])
        scope = self._scope_key(request)
        if frame:
            for message in messages:
                for tool_call in getattr(message, "tool_calls", []) or []:
                    if len(self._tool_parents) >= 256:
                        self._tool_parents.pop(next(iter(self._tool_parents)))
                    self._tool_parents[(scope, str(tool_call.get("id")))] = frame.call_id
        return entry

    @override
    def wrap_model_call(self, request, handler):
        if self._sink is None:
            return handler(request)
        with self._scope("model_call", request):
            return self._capture(request, handler, "model_call")

    @override
    async def awrap_model_call(self, request, handler):
        if self._sink is None:
            return await handler(request)
        with self._scope("model_call", request):
            return await self._acapture(request, handler, "model_call")

    def _entry(self, kind: str, payload: dict, digest: str, response: Any, request: Any) -> dict:
        return (
            self._model_entry(payload, digest, response, request)
            if kind == "model_call"
            else self._tool_entry(payload, digest, response)
        )

    def _capture(self, request: Any, handler: Any, kind: str) -> Any:
        payload = (
            _serialize_model_request(request)
            if kind == "model_call"
            else _serialize_tool_request(request)
        )
        digest = _hash_request(payload)
        started = time.monotonic()
        try:
            response = handler(request)
        except Exception as exc:
            entry = {
                "kind": kind,
                "req_hash": digest,
                "request": payload,
                "response": _serialize_error_response(exc),
            }
            try:
                self._record(request, entry, int((time.monotonic() - started) * 1000))
            except Exception as capture_error:
                log.debug("error capture unavailable: %s", type(capture_error).__name__)
            raise
        try:
            self._record(
                request,
                self._entry(kind, payload, digest, response, request),
                int((time.monotonic() - started) * 1000),
            )
        except Exception as capture_error:
            log.debug("response capture unavailable: %s", type(capture_error).__name__)
        return response

    async def _acapture(self, request: Any, handler: Any, kind: str) -> Any:
        payload = (
            _serialize_model_request(request)
            if kind == "model_call"
            else _serialize_tool_request(request)
        )
        digest = _hash_request(payload)
        started = time.monotonic()
        try:
            response = await handler(request)
        except Exception as exc:
            entry = {
                "kind": kind,
                "req_hash": digest,
                "request": payload,
                "response": _serialize_error_response(exc),
            }
            try:
                self._record(request, entry, int((time.monotonic() - started) * 1000))
            except Exception as capture_error:
                log.debug("error capture unavailable: %s", type(capture_error).__name__)
            raise
        try:
            self._record(
                request,
                self._entry(kind, payload, digest, response, request),
                int((time.monotonic() - started) * 1000),
            )
        except Exception as capture_error:
            log.debug("response capture unavailable: %s", type(capture_error).__name__)
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
        with self._scope("tool_call", request):
            return self._capture(request, handler, "tool_call")

    @override
    async def awrap_tool_call(self, request, handler):
        if self._sink is None:
            return await handler(request)
        with self._scope("tool_call", request):
            return await self._acapture(request, handler, "tool_call")


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
