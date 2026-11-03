"""Authenticated management of the existing reference corpus, not operational AKG."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from raptix.interfaces.api.auth import require_runtime_token
from raptix.knowledge.graph.query import GraphQuery
from raptix.knowledge.graph.store import KGStore
from raptix.knowledge.reference.catalog import CatalogConflict, catalog
from raptix.knowledge.reference.history import delete_retrieval, retrieval_history
from raptix.knowledge.reference.query import retrieve_reference

router = APIRouter(dependencies=[Depends(require_runtime_token)])


class KnowledgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    search: str = Field(default="", max_length=200)
    source: str = Field(default="", max_length=64)
    category: str = Field(default="", max_length=128)
    offset: int = Field(default=0, ge=0, le=100000)
    limit: int = Field(default=50, ge=1, le=100)
    id: str = Field(default="", max_length=512)
    thread_id: str = Field(default="", max_length=128)
    allow_partial: bool = False
    query: GraphQuery | None = None


@router.post("/_raptix/knowledge/{action}")
def knowledge(
    action: Literal[
        "status", "library", "detail", "scan", "index", "search", "history", "delete-history"
    ],
    body: KnowledgeRequest,
) -> dict[str, Any]:
    try:
        if action == "status":
            return catalog.status()
        if action == "library":
            return catalog.library(
                search=body.search,
                source=body.source,
                category=body.category,
                offset=body.offset,
                limit=body.limit,
            )
        if action == "detail":
            return catalog.detail(body.id)
        if action in {"scan", "index"}:
            return {
                "job": catalog.start(action, allow_partial=body.allow_partial),
                "message": "Source scan started"
                if action == "scan"
                else "Reference indexing started",
            }
        if action == "history":
            return retrieval_history(
                thread_id=body.thread_id, search=body.search, offset=body.offset, limit=body.limit
            )
        if action == "delete-history":
            return {"success": delete_retrieval(body.id)}
        if body.query is None or body.query.graph != "reference":
            raise ValueError("A closed reference query is required")
        store = KGStore.from_env()
        try:
            result = retrieve_reference(store, body.query)
        finally:
            store.close()
        return result
    except CatalogConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, "Reference document not found") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — management must expose unavailable dependencies without leaking secrets
        raise HTTPException(503, f"Knowledge operation unavailable ({type(exc).__name__})") from exc
