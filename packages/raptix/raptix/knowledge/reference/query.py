"""Read only reference labels through bounded, parameterized query templates."""

from __future__ import annotations

import json
from typing import Any

from raptix.knowledge.graph.query import MAX_QUERY_BYTES, GraphQuery, bounded_read
from raptix.knowledge.graph.store import KGStore


def query_reference(store: KGStore, query: GraphQuery) -> dict[str, Any]:
    p = query.params
    if query.query_type == "search_by_name":
        cypher = f"MATCH (n:{p.kind}) WHERE ($include OR n.deprecated_at IS NULL) AND toLower(n.name) CONTAINS toLower($q) RETURN [properties(n)] AS nodes, [] AS edges ORDER BY n.id LIMIT $cap"
    elif query.query_type == "technique_by_id":
        cypher = "MATCH (n:KrgReference {id: $id}) WHERE (n:KrgAttackTechnique OR n:KrgAtlasTechnique) AND ($include OR n.deprecated_at IS NULL) RETURN [properties(n)] AS nodes, [] AS edges LIMIT $cap"
    else:
        pattern = (
            f"[*1..{p.depth}]"
            if query.query_type == "neighbors"
            else (
                "[:MITIGATED_BY]"
                if query.query_type == "mitigations_for_technique"
                else "[:RELATED_WEAKNESS]"
            )
        )
        direction = (
            f"(n)-{pattern}-(m)"
            if query.query_type == "neighbors"
            else (
                f"(n)-{pattern}->(m)"
                if query.query_type == "mitigations_for_technique"
                else f"(n)<-{pattern}-(m:KrgCapec)"
            )
        )
        cypher = (
            "MATCH (n:KrgReference {id: $id}) "
            f"MATCH path={direction} "
            "WHERE all(v IN nodes(path) WHERE (v:KrgReference OR v:KrgUnresolvedRef) AND ($include OR v.deprecated_at IS NULL)) "
            "AND all(r IN relationships(path) WHERE $include OR r.deprecated_at IS NULL) "
            "RETURN [v IN nodes(path) | properties(v)] AS nodes, "
            "[r IN relationships(path) | {source: startNode(r).id, target: endNode(r).id, type: type(r), "
            "resolution_status: r.resolution_status, source_file_hash: r.source_file_hash}] AS edges LIMIT $cap"
        )
    rows = bounded_read(
        store, cypher, {"id": p.id, "q": p.q, "include": p.include_deprecated, "cap": p.limit + 1}
    )
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    truncated = len(rows) > p.limit
    for row in rows[: p.limit]:
        for node in row["nodes"]:
            if node["id"] not in nodes and len(nodes) >= p.limit:
                truncated = True
                continue
            nodes[node["id"]] = {
                key: value[:4000] if isinstance(value, str) else value
                for key, value in node.items()
                if key != "details_json"
            }
            details = json.loads(node.get("details_json") or "{}")
            nodes[node["id"]]["context"] = {
                key: details[key]
                for key in (
                    "prerequisites",
                    "mitigations",
                    "mitigation_links",
                    "detection_strategies",
                    "references",
                )
                if key in details
            }
        for edge in row["edges"]:
            if edge not in edges:
                if len(edges) < p.limit:
                    edges.append(edge)
                else:
                    truncated = True
    response: dict[str, Any] = {
        "nodes": list(nodes.values()),
        "edges": [edge for edge in edges if edge["source"] in nodes and edge["target"] in nodes],
        "truncated": truncated,
    }
    for node in response["nodes"]:
        if len(json.dumps(node["context"], default=str).encode()) > 6000:
            node["context"] = {}
            response["truncated"] = True
    while len(json.dumps(response, default=str).encode()) > MAX_QUERY_BYTES and response["nodes"]:
        response["nodes"].pop()
        response["edges"] = []
        response["truncated"] = True
    return response
