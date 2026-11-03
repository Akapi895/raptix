"""Serve read-only graph templates to the authenticated internal BFF."""

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field

from raptix.interfaces.api.auth import require_runtime_token
from raptix.knowledge.graph.query import GraphQuery, query_runtime
from raptix.knowledge.graph.store import KGStore, KGStoreConfigError
from raptix.knowledge.reference.query import query_reference

# Declared on the router itself (not only inherited from plugins_api.py's
# FastAPI(dependencies=[...])) so this router stays self-defending if ever
# mounted standalone — see test_internal_query_requires_runtime_authentication,
# which mounts it onto a bare FastAPI() app with no outer app-level dependency.
router = APIRouter(dependencies=[Depends(require_runtime_token)])
log = logging.getLogger(__name__)


class InternalGraphQuery(GraphQuery):
    # Only the authenticated BFF may supply this service-authorized scope.
    engagement: Annotated[
        str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    ]


@router.post("/_raptix/kg/query")
def query_graph(body: InternalGraphQuery) -> dict[str, Any]:
    if body.engagement == "schema":
        raise HTTPException(403, "reserved graph scope")
    store = None
    try:
        store = KGStore.from_env()
        if body.graph == "reference":
            return query_reference(store, body)
        return query_runtime(store, body.engagement, body)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "invalid graph query") from exc
    except (KGStoreConfigError, ImportError) as exc:
        raise HTTPException(503, "knowledge graph is unavailable") from exc
    except Exception as exc:  # noqa: BLE001 — don't leak DB configuration or query text over HTTP
        log.warning("Graph query failed (%s)", type(exc).__name__)
        raise HTTPException(503, "knowledge graph query failed") from exc
    finally:
        if store is not None:
            store.close()
