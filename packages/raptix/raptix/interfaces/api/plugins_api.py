"""Runtime plugin bundle activation API.

Mounted into the LangGraph platform via ``langgraph.json`` ``http.app``.
Lets the CLI ``/plugins`` slash command flip plugin bundles on or off
without restarting the langgraph container — by calling the same
``langgraph_api.graph.register_graph()`` the platform itself uses at
startup.

Bundle model
------------
Raptix's graph manifest is split into two bundles by
``raptix.graph_registry``:

  - ``standard``: official OSS agents (decepticon + 9 specialists).
    Always loaded at startup.
  - ``plugins``: vulnresearch family (orchestrator + 5 specialists).
    Off by default. Activated either via ``RAPTIX_PLUGINS`` env
    (next-restart) or this API (immediately).

Endpoints
---------
GET  ``/_decepticon/bundles``                 — list bundles + enabled state
POST ``/_decepticon/bundles/{name}/enable``   — register every graph in bundle
POST ``/_decepticon/bundles/{name}/disable``  — drop every graph in bundle

Enable is idempotent (``register_graph`` uses ``if_exists="do_nothing"``
in the Assistants table). Disable mutates the in-memory ``GRAPHS`` dict
and removes the system-created assistant row, so the next
``/assistants/search`` no longer returns it.

Persistence
-----------
This API is **runtime-only** in this iteration. Bundles re-enabled here
do NOT persist across ``decepticon restart`` — for permanent activation
set ``RAPTIX_PLUGINS=standard,plugins`` in ``~/.decepticon/.env``.
A future iteration will add a state file so the API also persists.
"""

# NOTE: deliberately NO ``from __future__ import annotations`` here —
# LangGraph Platform mounts this module under a synthetic name
# (``user_router_module``) and pydantic's lazy forward-ref resolution
# fails to find ``BundleStatus`` etc. when the response models are
# introspected for OpenAPI schema generation. Eager-evaluating
# annotations sidesteps the namespace mismatch.

import importlib
import logging
from typing import Annotated
from uuid import uuid5

from fastapi import Depends, FastAPI, HTTPException, Path, Query
from pydantic import BaseModel, Field

from raptix.graph_registry import _BUNDLE_TO_GRAPHS  # private, but stable: bundle->graphs map
from raptix.interfaces.api.auth import require_runtime_token
from raptix.interfaces.api.finding_poc_routes import router as finding_poc_router

logger = logging.getLogger(__name__)


# ── Wire models ──────────────────────────────────────────────────────────────


class BundleStatus(BaseModel):
    name: str
    enabled: bool
    graphs: list[str]


class BundlesResponse(BaseModel):
    bundles: list[BundleStatus]


class ToggleResponse(BaseModel):
    bundle: str
    enabled: bool
    graphs: list[str]
    skipped: list[str] = []


# ── Helpers ──────────────────────────────────────────────────────────────────


def _path_to_module(spec: str) -> tuple[str, str]:
    """Turn ``"./decepticon/agents/plugins/vulnresearch.py:graph"`` into
    ``("raptix.intelligence.agents.plugins.vulnresearch", "graph")``.

    The graph_registry stores entries in the file-path form LangGraph
    Platform expects in ``langgraph.json``. For runtime registration we
    need importable module + attribute, which is more robust against
    CWD changes.
    """
    path, _, variable = spec.partition(":")
    if not variable:
        raise ValueError(f"bundle spec missing ':variable' suffix: {spec!r}")
    module = path.removeprefix("./").removesuffix(".py").replace("/", ".").lstrip(".")
    return module, variable


def _load_graph(module_path: str, variable: str):
    """Import the module and pull out the compiled graph attribute."""
    module = importlib.import_module(module_path)
    try:
        return getattr(module, variable)
    except AttributeError as exc:
        raise HTTPException(
            status_code=500,
            detail=(f"module {module_path!r} does not export attribute {variable!r}"),
        ) from exc


def _resolve_bundle(name: str) -> dict[str, str]:
    """Look up a bundle by name, 404 on unknown."""
    try:
        return _BUNDLE_TO_GRAPHS[name]
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"unknown bundle: {name!r}") from exc


def _registered_graph_ids() -> set[str]:
    """Snapshot of which graph IDs the platform currently exposes.

    Imported lazily because ``langgraph_api`` is only importable inside
    the LangGraph platform process — pulling it at module load time
    would make ``raptix.server.plugins_api`` un-importable from
    plain unit tests / scripts.
    """
    from langgraph_api.graph import GRAPHS  # noqa: PLC0415

    return set(GRAPHS.keys())


# ── App ──────────────────────────────────────────────────────────────────────


app = FastAPI(
    title="Raptix plugin bundle API",
    summary="Runtime activation/deactivation of agent bundles on the LangGraph platform.",
    # Every route here (bundle switches, instance grants, transcripts) needs the runtime API token, the same one the
    # LangGraph API checks. Routes added to this app are not covered by the LangGraph auth handler, so each one checks it.
    dependencies=[Depends(require_runtime_token)],
)
app.include_router(finding_poc_router)


@app.get("/_decepticon/bundles", response_model=BundlesResponse)
async def list_bundles() -> BundlesResponse:
    """List every known bundle plus its current enabled state.

    A bundle is *enabled* iff every graph it contributes is currently in
    ``GRAPHS``. Partial state (some graphs registered, some not) is
    reported as enabled=False — that should never happen under normal
    operation but the check is cheap.
    """
    registered = _registered_graph_ids()
    return BundlesResponse(
        bundles=[
            BundleStatus(
                name=name,
                enabled=all(gid in registered for gid in graphs),
                graphs=list(graphs),
            )
            for name, graphs in _BUNDLE_TO_GRAPHS.items()
        ]
    )


@app.post("/_decepticon/bundles/{name}/enable", response_model=ToggleResponse)
async def enable_bundle(
    name: Annotated[str, Path(min_length=1, max_length=64)],
) -> ToggleResponse:
    """Register every graph in the named bundle into the live LangGraph platform.

    Idempotent: re-enabling an already-loaded bundle is a no-op (the
    underlying ``register_graph`` uses ``if_exists="do_nothing"`` on the
    Assistants table and re-assigning ``GRAPHS[gid]`` is harmless).
    """
    from langgraph_api.graph import GRAPHS, register_graph  # noqa: PLC0415

    graphs = _resolve_bundle(name)
    registered: list[str] = []
    skipped: list[str] = []

    for graph_id, spec in graphs.items():
        if graph_id in GRAPHS:
            skipped.append(graph_id)
            continue
        module_path, variable = _path_to_module(spec)
        graph_obj = _load_graph(module_path, variable)
        try:
            await register_graph(graph_id, graph_obj, config=None)
        except Exception as exc:  # noqa: BLE001
            logger.exception("register_graph failed for %s", graph_id)
            raise HTTPException(
                status_code=500,
                detail=f"register_graph({graph_id}) failed: {exc}",
            ) from exc
        registered.append(graph_id)
        logger.info("plugin bundle %r: registered graph %r", name, graph_id)

    return ToggleResponse(
        bundle=name,
        enabled=True,
        graphs=registered,
        skipped=skipped,
    )


@app.post("/_decepticon/bundles/{name}/disable", response_model=ToggleResponse)
async def disable_bundle(
    name: Annotated[str, Path(min_length=1, max_length=64)],
) -> ToggleResponse:
    """Drop every graph in the named bundle.

    Removes the in-memory ``GRAPHS`` entry and deletes the system-owned
    Assistants row that ``register_graph`` created at enable time. The
    UUID for that row is deterministic (``uuid5(NAMESPACE_GRAPH,
    graph_id)``) — see ``langgraph_api.graph.register_graph``.

    Refuses to disable the ``standard`` bundle: those graphs are the
    core agent set and removing them mid-session would brick the
    orchestrator.
    """
    if name == "standard":
        raise HTTPException(
            status_code=400,
            detail=(
                "'standard' bundle cannot be disabled — it carries the "
                "core orchestrator. Set RAPTIX_PLUGINS at startup to "
                "ship a custom baseline."
            ),
        )

    from langgraph_api.graph import (  # noqa: PLC0415
        GRAPHS,
        NAMESPACE_GRAPH,
        SYSTEM_ASSISTANT_IDS,
    )
    from langgraph_runtime.database import connect  # noqa: PLC0415

    if lg_api_feature_postgres():
        from langgraph_api.grpc.ops import Assistants  # noqa: PLC0415
    else:
        from langgraph_runtime.ops import Assistants  # noqa: PLC0415

    graphs = _resolve_bundle(name)
    removed: list[str] = []
    skipped: list[str] = []

    for graph_id in graphs:
        if graph_id not in GRAPHS:
            skipped.append(graph_id)
            continue
        del GRAPHS[graph_id]
        assistant_id = uuid5(NAMESPACE_GRAPH, graph_id)
        SYSTEM_ASSISTANT_IDS.discard(str(assistant_id))
        try:
            async with connect() as conn:
                async for _ in await Assistants.delete(conn, assistant_id):
                    pass
        except Exception:  # noqa: BLE001
            # Assistants row may not exist (e.g. the user manually
            # deleted it via /assistants/{id} DELETE). The in-memory
            # mutation is what gates further usage; DB cleanup is
            # best-effort. Log and continue.
            logger.warning(
                "could not delete Assistants row for %s — proceeding",
                graph_id,
                exc_info=True,
            )
        removed.append(graph_id)
        logger.info("plugin bundle %r: unregistered graph %r", name, graph_id)

    return ToggleResponse(
        bundle=name,
        enabled=False,
        graphs=removed,
        skipped=skipped,
    )


def lg_api_feature_postgres() -> bool:
    """Mirror the same backend selector langgraph_api.graph uses."""
    from langgraph_api.feature_flags import IS_POSTGRES_OR_GRPC_BACKEND  # noqa: PLC0415

    return IS_POSTGRES_OR_GRPC_BACKEND


# ── Operator mailbox for running dispatch instances (P10c) ─────────────
# A message is durably accepted, delivered at the instance's model-call safe
# point, and handled when that turn completes. A refusal is an explicit
# reason, never a silent drop. The mailbox lives beside the checkpointer.

_INSTANCE_PATH = "/_raptix/instances/{thread_id}/{dispatch_id}"


class InstanceMessageIn(BaseModel):
    messageId: str
    body: str
    expectedAttempt: int = Field(ge=1)
    # Set only by the operator's explicit forward; the runtime never copies a message between attempts.
    sourceMessageId: str | None = None


class InstanceCancelIn(BaseModel):
    expectedAttempt: int = Field(ge=1)


class InstanceGrantIn(BaseModel):
    commandId: str
    kind: str
    expectedAttempt: int = Field(ge=1)
    reassignRole: str | None = None


@app.post(_INSTANCE_PATH + "/messages")
def post_instance_message(
    thread_id: Annotated[str, Path(min_length=1, max_length=256)],
    dispatch_id: Annotated[str, Path(min_length=1, max_length=256)],
    payload: InstanceMessageIn,
) -> dict:
    from fastapi.responses import JSONResponse  # noqa: PLC0415

    from raptix.execution.session.instance_mailbox import default_mailbox  # noqa: PLC0415

    result = default_mailbox().accept(
        payload.messageId,
        thread_id,
        dispatch_id,
        payload.body,
        expected_attempt=payload.expectedAttempt,
        source_message_id=payload.sourceMessageId,
    )
    body = {
        "status": result.status,
        "reason": result.reason,
        "attempt": result.attempt,
        "message": _message_view(result.message),
    }
    if result.status == "refused":
        return JSONResponse(status_code=409, content=body)
    return body


@app.post(_INSTANCE_PATH + "/cancel")
def post_instance_cancel(
    thread_id: Annotated[str, Path(min_length=1, max_length=256)],
    dispatch_id: Annotated[str, Path(min_length=1, max_length=256)],
    payload: InstanceCancelIn,
) -> dict:
    """Cooperative cancel of one attempt: the cancel is recorded now; the final observation comes from the dispatch."""
    from fastapi.responses import JSONResponse  # noqa: PLC0415

    from raptix.execution.session.instance_mailbox import default_mailbox  # noqa: PLC0415

    box = default_mailbox()
    state = box.request_cancel(thread_id, dispatch_id, payload.expectedAttempt)
    body = {
        "threadId": thread_id,
        "dispatchId": dispatch_id,
        "attempt": payload.expectedAttempt,
        "state": state,
    }
    if state == "cancel_requested":
        return body
    reason = "unknown_attempt" if state == "not_found" else "instance_not_running"
    return JSONResponse(status_code=409, content={**body, "reason": reason})


@app.post(_INSTANCE_PATH + "/grants")
def post_instance_grant(
    thread_id: Annotated[str, Path(min_length=1, max_length=256)],
    dispatch_id: Annotated[str, Path(min_length=1, max_length=256)],
    payload: InstanceGrantIn,
) -> dict:
    """An operator's Retry or Reassign of an ended attempt: the runtime records it with the attempt's persisted intent (ADR-0090)."""
    from fastapi.responses import JSONResponse  # noqa: PLC0415

    from raptix.execution.session.instance_mailbox import default_mailbox  # noqa: PLC0415

    result = default_mailbox().open_grant(
        payload.commandId,
        thread_id,
        dispatch_id,
        payload.expectedAttempt,
        payload.kind,
        payload.reassignRole,
    )
    body = {
        "status": result.status,
        "reason": result.reason,
        "grant": None if result.grant is None else _grant_view(result.grant),
    }
    if result.status == "refused":
        return JSONResponse(status_code=409, content=body)
    return body


@app.post(_INSTANCE_PATH + "/grants/{command_id}/revoke")
def post_instance_grant_revoke(
    thread_id: Annotated[str, Path(min_length=1, max_length=256)],
    dispatch_id: Annotated[str, Path(min_length=1, max_length=256)],
    command_id: Annotated[str, Path(min_length=1, max_length=128)],
) -> dict:
    """Withdraw a grant whose run was refused before the replacement was admitted; a consumed grant is never revived."""
    from raptix.execution.session.instance_mailbox import default_mailbox  # noqa: PLC0415

    return {"commandId": command_id, "state": default_mailbox().revoke_grant(command_id)}


def _grant_view(grant) -> dict:
    return {
        "commandId": grant.command_id,
        "kind": grant.kind,
        "sourceDispatchId": grant.source_dispatch_id,
        "sourceAttempt": grant.source_attempt,
        "targetDispatchId": grant.target_dispatch_id,
        "targetRole": grant.target_role,
        "state": grant.state,
    }


@app.get(_INSTANCE_PATH)
def get_instance(
    thread_id: Annotated[str, Path(min_length=1, max_length=256)],
    dispatch_id: Annotated[str, Path(min_length=1, max_length=256)],
) -> dict:
    from raptix.execution.session.instance_mailbox import default_mailbox  # noqa: PLC0415

    instances, messages = default_mailbox().snapshot(thread_id, dispatch_id)
    return {
        "threadId": thread_id,
        "dispatchId": dispatch_id,
        "instances": [
            {
                "attempt": row.attempt,
                "role": row.role,
                "state": row.state,
                "startedAt": row.started_at,
                "finishedAt": row.finished_at,
                "intent": row.intent,
                "objectiveId": row.objective_id,
            }
            for row in instances
        ],
        "messages": [_message_view(message) for message in messages],
    }


@app.get("/_raptix/threads/{thread_id}/instances")
def list_thread_instances(
    thread_id: Annotated[str, Path(min_length=1, max_length=256)],
) -> dict:
    """Every dispatch attempt the mailbox recorded on a thread, running ones included (roster, P10)."""
    from raptix.execution.session.instance_mailbox import default_mailbox  # noqa: PLC0415

    return {
        "threadId": thread_id,
        "instances": [
            {
                "dispatchId": row.dispatch_id,
                "attempt": row.attempt,
                "role": row.role,
                "state": row.state,
                "startedAt": row.started_at,
                "finishedAt": row.finished_at,
                "parentDispatchId": row.parent_dispatch_id,
            }
            for _, row in default_mailbox().list_instances(thread_id)
        ],
    }


@app.get("/_raptix/threads/{thread_id}/transcripts")
def list_thread_transcripts(
    thread_id: Annotated[str, Path(min_length=1, max_length=256)],
    before: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> dict:
    """Sub-agent events recorded on a thread, newest page first by ``before`` (exclusive sequence number).

    The events are the sidecar copy written as they streamed (see ``transcript_sidecar``), so they are not part of the
    graph state. ``oldestSeq`` is the cursor for the next older page; it is null when this page starts the thread.
    """
    from raptix.execution.session.transcript_sidecar import default_sidecar  # noqa: PLC0415

    rows = default_sidecar().page(thread_id, before, limit)
    return {
        "threadId": thread_id,
        "events": [{"seq": seq, "event": event} for seq, event in rows],
        "oldestSeq": rows[0][0] if rows else None,
    }


def _message_view(message) -> dict | None:
    if message is None:
        return None
    return {
        "messageId": message.message_id,
        "attempt": message.attempt,
        "seq": message.seq,
        "body": message.body,
        "state": message.state,
        "acceptedAt": message.accepted_at,
        "deliveredAt": message.delivered_at,
        "handledAt": message.handled_at,
        "outcome": message.outcome,
        "sourceMessageId": message.source_message_id,
    }
