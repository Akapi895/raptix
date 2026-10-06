"""Semantic KG read tools (Wave T4).

Three structured-projection tools replace the low-level ``kg_query`` /
``kg_neighbors`` / ``kg_stats`` CRUD surface:

- ``search_knowledge(query)``   — keyword search across labels/keys/props
- ``inspect_asset(node_id)``    — one asset + its 1-hop neighborhood
- ``find_attack_paths(...)``    — cheapest entrypoint → crown-jewel chains

All are read-only: the agent reads the graph through projections and
never touches raw CRUD (KG mutation happens via ``kg_record`` and the
auto-ingest pipeline).
"""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool

from raptix.execution.tools.research._state import _json, graph_transaction, kg_degrades
from raptix.execution.tools.research.chain import critical_path_score, plan_chains
from raptix_core.types.kg import NodeKind


@tool
@kg_degrades
def search_knowledge(query: str, kind: str = "", limit: int = 15) -> str:
    """Search the engagement knowledge graph for assets matching a keyword.

    Matches are case-insensitive substrings over node labels, keys, and
    string property values. Use this instead of raw kind dumps: "tomcat",
    "10.0.0.", "ssh", "CVE-2024", a hostname, a file path.

    Args:
        query: Keyword or fragment to search for (min 2 chars).
        kind: Optional NodeKind filter (e.g. "Host", "Vulnerability").
        limit: Max results (default 15, capped at 50).

    Returns:
        JSON with ranked matches: {total, returned, results}.
    """
    needle = query.strip().lower()
    if len(needle) < 2:
        return _json({"error": "query must be at least 2 characters"})
    limit = max(1, min(limit, 50))
    if kind:
        try:
            node_kind = NodeKind(kind)
        except ValueError:
            return _json({"error": f"unknown kind: {kind}", "valid": [k.value for k in NodeKind]})
    else:
        node_kind = None

    with graph_transaction() as graph:
        nodes = (
            list(graph.by_kind(node_kind)) if node_kind is not None else list(graph.nodes.values())
        )
        label_hits: list[dict[str, Any]] = []
        other_hits: list[dict[str, Any]] = []
        for node in nodes:
            key = node.props.get("key")
            if needle in node.label.lower():
                ranked_bucket = label_hits
            elif (key and needle in key.lower()) or any(
                needle in str(v).lower() for v in node.props.values() if isinstance(v, str)
            ):
                ranked_bucket = other_hits
            else:
                continue
            ranked_bucket.append(
                {"id": node.id, "kind": node.kind.value, "label": node.label, "key": key}
            )
        ranked = label_hits + other_hits
        return _json(
            {
                "total": len(ranked),
                "returned": min(len(ranked), limit),
                "results": ranked[:limit],
            }
        )


@tool
@kg_degrades
def inspect_asset(node_id: str) -> str:
    """Inspect one asset: its properties plus every node one hop away.

    Use after search_knowledge to understand how an asset connects:
    vulnerabilities, exposed services, credentials, locations.

    Args:
        node_id: Node id (from search_knowledge results).

    Returns:
        JSON projection {asset, neighbors_out, neighbors_in}.
    """
    with graph_transaction() as graph:
        node = graph.nodes.get(node_id)
        if node is None:
            return _json({"error": "node not found", "id": node_id})
        edges_out = graph.neighbors(node_id, direction="out")
        edges_in = graph.neighbors(node_id, direction="in")

        def _pair(e: Any, n: Any) -> dict[str, Any]:
            return {
                "edge_kind": e.kind.value,
                "edge_weight": e.weight,
                "id": n.id,
                "kind": n.kind.value,
                "label": n.label,
            }

        return _json(
            {
                "asset": {
                    "id": node.id,
                    "kind": node.kind.value,
                    "label": node.label,
                    "key": node.props.get("key"),
                    "props": node.props,
                },
                "neighbors_out": [_pair(e, n) for e, n in edges_out],
                "neighbors_in": [_pair(e, n) for e, n in edges_in],
            }
        )


@tool
@kg_degrades
def find_attack_paths(top_k: int = 5, max_depth: int = 8, max_cost: float = 20.0) -> str:
    """Enumerate cheapest attack chains from entrypoints to crown jewels.

    Read-only projection of the same planner the analyst's
    ``plan_attack_chains`` uses — for any role that needs to know HOW an
    asset is reachable before acting. Lower cost = easier exploitation.

    Args:
        top_k: Max chains to return (default 5).
        max_depth: Max hops per chain (default 8).
        max_cost: Discard paths exceeding this total cost (default 20).

    Returns:
        JSON {count, chains} with hop sequence, total cost, and
        critical-path score per chain.
    """
    top_k = max(1, min(top_k, 20))
    chains = plan_chains(max_depth=max(1, max_depth), max_cost=max_cost, top_k=top_k)
    return _json(
        {
            "count": len(chains),
            "chains": [{**c.to_dict(), "score": round(critical_path_score(c), 3)} for c in chains],
        }
    )
