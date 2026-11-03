"""Execute closed, resource-bounded graph queries shared by tools and HTTP."""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from raptix.knowledge.graph.store import KGStore
from raptix.knowledge.graph.trust import PRIVATE_FIELDS, redact_graph_text
from raptix_core.types.kg import NodeKind

MAX_QUERY_BYTES = 64_000
QUERY_TIMEOUT_SECONDS = 4.0
# Whole-inventory reads scan every reference node; a cold Neo4j cache or a
# concurrent index write can exceed the interactive statement ceiling.
INVENTORY_TIMEOUT_SECONDS = 20.0
_PUBLIC_PROPS = frozenset(
    {
        "ip",
        "host",
        "hostname",
        "domain",
        "port",
        "protocol",
        "service",
        "url",
        "severity",
        "cve",
        "cwe",
        "description",
        "summary",
        "status",
        "explored",
        "technology",
        "product",
        "version",
        "credential_ref",
        "source_artifact_ref",
        "source_artifact_digest",
        "firstseen",
        "lastupdated",
        "created_by",
        "source_episode_id",
        "provenance_channel",
        "trust_state",
        "observation_id",
        "verification_ref",
        "verification_outcome",
        "asset_id",
        "conflict_detected",
        "previous_status",
        "previous_version",
        "previous_severity",
        "previous_source_episode_id",
        "name",
        "path",
        "method",
        "auth_model",
        "content_type",
        "body_type",
        "location",
        "required",
        "input_type",
        "param_type",
    }
)


class QueryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str = "Host"
    key: str = Field(default="", max_length=2048)
    q: str = Field(default="", max_length=200)
    id: str = Field(default="", max_length=512)
    depth: int = Field(default=1, ge=1, le=2)
    limit: int = Field(default=20, ge=1, le=20)
    include_deprecated: bool = False


class GraphQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    graph: Literal["runtime", "reference"] = "runtime"
    query_type: Literal[
        "observation",
        "search",
        "neighbors",
        "technique_by_id",
        "mitigations_for_technique",
        "capec_for_cwe",
        "search_by_name",
    ]
    params: QueryParams = Field(default_factory=QueryParams)

    @model_validator(mode="after")
    def validate_vocabulary(self) -> GraphQuery:
        if self.graph == "runtime":
            if self.query_type not in {"observation", "search", "neighbors"}:
                raise ValueError("unsupported runtime query")
            NodeKind(self.params.kind)
            if self.query_type != "search" and (
                not self.params.key or "kind" not in self.params.model_fields_set
            ):
                raise ValueError("observation identity requires kind and key")
        else:
            from raptix.knowledge.reference.schema import LABELS

            if self.query_type not in {
                "technique_by_id",
                "mitigations_for_technique",
                "capec_for_cwe",
                "neighbors",
                "search_by_name",
            }:
                raise ValueError("unsupported reference query")
            if self.query_type == "search_by_name" and self.params.kind not in LABELS:
                raise ValueError("reference search requires a Krg label")
            if self.query_type != "search_by_name" and not self.params.id:
                raise ValueError("reference lookup requires id")
        return self


def bounded_read(
    store: KGStore,
    cypher: str,
    params: dict[str, Any],
    *,
    timeout: float | None = None,
) -> list[dict[str, Any]]:
    """Templates own scope; the driver enforces a transaction-time ceiling."""
    from neo4j import unit_of_work

    @unit_of_work(timeout=timeout or QUERY_TIMEOUT_SECONDS)
    def read(tx: Any) -> list[dict[str, Any]]:
        return [dict(row) for row in tx.run(cypher, **params)]

    with store._driver.session(database=store._database) as session:
        return session.execute_read(read)


def public_node(node: dict[str, Any]) -> dict[str, Any]:
    props = node.get("props") or {}
    sensitive = node.get("kind") in {"Credential", "Secret"}
    allowed = (
        _PUBLIC_PROPS
        if not sensitive
        else frozenset(
            {
                "credential_ref",
                "firstseen",
                "lastupdated",
                "created_by",
                "source_episode_id",
                "provenance_channel",
                "trust_state",
                "observation_id",
                "source_artifact_ref",
                "source_artifact_digest",
            }
        )
    )
    safe = {
        key: redact_graph_text(value[:2000]) if isinstance(value, str) else value
        for key, value in props.items()
        if key in allowed
        and key not in PRIVATE_FIELDS
        and (value is None or isinstance(value, (str, int, float, bool)))
    }
    safe.setdefault("provenance_channel", "legacy_unknown")
    safe.setdefault("trust_state", "unverified")
    identity = str(props.get("observation_id") or node.get("opaque_id") or "")
    raw_key = str(node.get("key") or "")
    safe_key = redact_graph_text(raw_key)
    if (sensitive and not raw_key.startswith("credential-ref::")) or safe_key != raw_key:
        safe_key = f"observation::{identity}"
    label = (
        "Credential reference"
        if sensitive
        else redact_graph_text(str(node.get("label") or safe_key))[:512]
    )
    if sensitive and not str(safe.get("credential_ref") or "").startswith(
        ("vault://", "credential://", "workspace-evidence://")
    ):
        safe.pop("credential_ref", None)
    safe.setdefault("observation_id", identity)
    return {"kind": node.get("kind"), "key": safe_key, "label": label, "props": safe}


def query_runtime(store: KGStore, engagement: str, query: GraphQuery) -> dict[str, Any]:
    store._check_engagement(engagement)
    if engagement == "schema":
        raise ValueError("schema is not an engagement")
    p = query.params
    origin = f"MATCH (n:{p.kind} {{engagement: $engagement}}) "
    predicate = (
        "WHERE n.key = $key OR coalesce(n.observation_id, elementId(n)) = $lookup "
        if query.query_type != "search"
        else ("WHERE $q = '' OR toLower(coalesce(n.label, n.key)) CONTAINS toLower($q) ")
    )
    projection = "{kind: head(labels(n)), key: n.key, label: n.label, opaque_id: elementId(n), props: properties(n)}"
    if query.query_type == "neighbors":
        cypher = (
            origin
            + predicate
            + (
                f"MATCH path=(n)-[*1..{p.depth}]-(m) "
                "WHERE all(v IN nodes(path) WHERE v.engagement = $engagement) "
                "AND all(r IN relationships(path) WHERE r.engagement = $engagement) "
                "RETURN [v IN nodes(path) | {kind: head(labels(v)), key: v.key, "
                "label: v.label, opaque_id: elementId(v), props: properties(v)}] AS nodes, "
                "[r IN relationships(path) | {source: startNode(r).key, "
                "source_kind: head(labels(startNode(r))), target: endNode(r).key, "
                "target_kind: head(labels(endNode(r))), type: type(r), "
                "provenance_channel: coalesce(r.provenance_channel, 'legacy_unknown'), "
                "trust_state: coalesce(r.trust_state, 'unverified')}] AS edges LIMIT $cap"
            )
        )
    else:
        cypher = (
            origin
            + predicate
            + f"RETURN [{projection}] AS nodes, [] AS edges ORDER BY n.key LIMIT $cap"
        )
    rows = bounded_read(
        store,
        cypher,
        {
            "engagement": engagement,
            "key": p.key,
            "lookup": p.key.removeprefix("observation::")
            if p.key.startswith("observation::")
            else "",
            "q": p.q,
            "cap": p.limit + 1,
        },
    )
    nodes: dict[tuple[str, str], dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    truncated = len(rows) > p.limit
    for row in rows[: p.limit]:
        for node in row["nodes"]:
            identity = (node["kind"], node["key"])
            if identity not in nodes and len(nodes) >= p.limit:
                truncated = True
                continue
            nodes[identity] = public_node(node)
        for edge in row["edges"]:
            if edge not in edges and len(edges) < p.limit:
                edges.append(edge)
            elif edge not in edges:
                truncated = True
    visible = [
        edge
        for edge in edges
        if (edge["source_kind"], edge["source"]) in nodes
        and (edge["target_kind"], edge["target"]) in nodes
    ]
    for edge in visible:
        edge["source"] = nodes[(edge["source_kind"], edge["source"])]["key"]
        edge["target"] = nodes[(edge["target_kind"], edge["target"])]["key"]
    response: dict[str, Any] = {
        "nodes": list(nodes.values()),
        "edges": visible,
        "truncated": truncated,
    }
    while len(json.dumps(response, default=str).encode()) > MAX_QUERY_BYTES and response["nodes"]:
        response["nodes"].pop()
        response["edges"] = []
        response["truncated"] = True
    return response
