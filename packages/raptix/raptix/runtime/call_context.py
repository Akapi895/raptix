"""Content-free identities and client-to-provider/proxy HTTP attempt observations."""

import os
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from langchain.agents.middleware import ModelFallbackMiddleware

from raptix.core.dispatch_context import active_dispatch


class TracedModelFallback(ModelFallbackMiddleware):
    def wrap_model_call(self, request: Any, handler: Any) -> Any:
        with call_scope("logical_call", request):
            return super().wrap_model_call(request, handler)

    async def awrap_model_call(self, request: Any, handler: Any) -> Any:
        with call_scope("logical_call", request):
            return await super().awrap_model_call(request, handler)


@dataclass
class Call:
    kind: str
    call_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    logical_call_id: str = ""
    parent_attempt_id: str | None = None
    run_id: str | None = None
    attempts: list[dict[str, Any]] = field(default_factory=list)


active_call: ContextVar[Call | None] = ContextVar("active_recorded_call", default=None)


@contextmanager
def call_scope(kind: str, request: Any = None, parent_id: str | None = None) -> Iterator[Call]:
    parent = active_call.get()
    dispatch = active_dispatch.get()
    frame = Call(kind)
    frame.logical_call_id = (
        parent.call_id if parent and parent.kind == "logical_call" else frame.call_id
    )
    frame.parent_attempt_id = (
        parent_id
        or (parent.call_id if parent else None)
        or (
            dispatch.parent_call_id or f"{dispatch.dispatch_id}:{dispatch.attempt}"
            if dispatch
            else None
        )
    )
    from langgraph.config import get_config

    try:
        config = get_config()
    except RuntimeError:
        config = getattr(getattr(request, "runtime", None), "config", None) or {}
    frame.run_id = str((config.get("configurable") or {}).get("thread_id") or "") or None
    token = active_call.set(frame)
    try:
        yield frame
    finally:
        active_call.reset(token)


def identity() -> dict[str, Any]:
    frame = active_call.get()
    dispatch = active_dispatch.get()
    return {
        "attempt_id": frame.call_id if frame else uuid.uuid4().hex,
        "logical_call_id": frame.logical_call_id if frame else None,
        "parent_attempt_id": frame.parent_attempt_id
        if frame
        else (
            dispatch.parent_call_id or f"{dispatch.dispatch_id}:{dispatch.attempt}"
            if dispatch
            else None
        ),
        "run_id": frame.run_id if frame else None,
        "dispatch_id": dispatch.dispatch_id if dispatch else None,
        "worker_instance_id": dispatch.lease_token if dispatch else None,
        "observable_attempt_boundary": "client_http",
        "proxy_internal_attempts": "unknown",
    }


def _request(request: Any) -> None:
    frame = active_call.get()
    if frame is None or len(frame.attempts) >= 64:
        return
    entry = {
        "attempt_id": uuid.uuid4().hex,
        "parent_attempt_id": frame.call_id,
        "logical_call_id": frame.logical_call_id,
        "outcome": "outcome_unknown",
        "started": time.monotonic(),
    }
    frame.attempts.append(entry)
    request.extensions["raptix_attempt"] = entry


def _response(response: Any) -> None:
    entry = response.request.extensions.get("raptix_attempt")
    if isinstance(entry, dict):
        entry["http_status"] = response.status_code
        entry["outcome"] = "succeeded" if response.status_code < 400 else "failed"
        entry["dur_ms"] = int((time.monotonic() - entry["started"]) * 1000)


async def _arequest(request: Any) -> None:
    _request(request)


async def _aresponse(response: Any) -> None:
    _response(response)


def instrument_model(model: Any) -> None:
    if not os.environ.get("RAPTIX_RUNTIME__RECORD_PATH"):
        return
    for name, request_hook, response_hook in (
        ("root_client", _request, _response),
        ("root_async_client", _arequest, _aresponse),
    ):
        client = getattr(getattr(model, name, None), "_client", None)
        hooks = getattr(client, "event_hooks", None)
        if isinstance(hooks, dict):
            for key, hook in (("request", request_hook), ("response", response_hook)):
                if hook not in hooks.setdefault(key, []):
                    hooks[key].append(hook)
