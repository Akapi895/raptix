"""Materialize parser observations onto the knowledge graph.

Parsers (see ``raptix.knowledge.ingest.parsers``) emit graph-write
observations in the node-plus-``edges_out`` shape that both write paths
understand:

  * :func:`apply_observations` — upserts :class:`Node`/:class:`Edge`
    objects into the in-memory engagement ``KnowledgeGraph`` used by the
    internal ``kg_ingest_*`` services (legacy-shim write path).
  * :func:`observations_to_records` — plain dicts for
    ``KGStore.record_observations`` (auto-ingest write path).

Both consumers skip ``parse.summary`` observations; neither mutates the
input. Edges reference peers by ``to_key`` and are resolved after every
node observation is upserted, so emit order never matters.

``ParserRegistry`` stamps every observation with ``source_artifact_id``
and ``parser_id`` (see ``registry.py``'s ``_stamp``) so a node written
through either path carries a pointer back to the artifact and parser
that produced it — the capability layer's provenance chain, not the
KG's own ``created_by``/``source_episode_id`` fields that
``KGStore.record_observations`` injects separately.
``Observation.confidence`` is deliberately NOT propagated here: at
least one parser (``slither_json``) already writes a domain-specific
``props["confidence"]`` string (Slither's own Low/Medium/High rating),
and overwriting that with the parser-confidence float would be a
silent regression, not a provenance improvement.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from raptix.knowledge.ingest.registry import iter_node_observations
from raptix_core.types.capability import Observation
from raptix_core.types.kg import Edge, EdgeKind, KnowledgeGraph, Node, NodeKind

_EDGE_RESERVED = {"to_key", "kind", "weight"}


def _props_with_provenance(observation: Observation) -> dict[str, Any]:
    """Observation ``props`` plus the parser-stamped artifact/parser pointers."""
    props = dict(observation.data.get("props") or {})
    if observation.source_artifact_id is not None:
        props["source_artifact_id"] = observation.source_artifact_id
    if observation.parser_id is not None:
        props["parser_id"] = observation.parser_id
    return props


def apply_observations(graph: KnowledgeGraph, observations: Iterable[Observation]) -> None:
    """Upsert every node observation into ``graph``, then every edge.

    Raises ``ValueError`` on an unknown node/edge kind — parsers are
    in-repo code and a bad kind must fail loudly, not silently drop.
    Dangling ``to_key`` references (peer not emitted in the same batch)
    are skipped so a partially-formed record cannot corrupt the graph.
    """
    node_observations = list(iter_node_observations(observations))
    key_to_id: dict[str, str] = {}
    for observation in node_observations:
        data = observation.data
        key = data.get("key")
        if not isinstance(key, str) or not key:
            raise ValueError(f"observation kind={observation.kind!r} missing 'key'")
        node = Node.make(
            NodeKind(observation.kind),
            str(data.get("label") or key),
            key=key,
            **_props_with_provenance(observation),
        )
        graph.upsert_node(node)
        key_to_id[key] = node.id
    for observation in node_observations:
        source_id = key_to_id[str(observation.data["key"])]
        for edge in observation.data.get("edges_out") or ():
            if not isinstance(edge, dict):
                continue
            dst_id = key_to_id.get(str(edge.get("to_key") or ""))
            if dst_id is None:
                continue
            props = {k: v for k, v in edge.items() if k not in _EDGE_RESERVED}
            graph.upsert_edge(
                Edge.make(
                    source_id,
                    dst_id,
                    EdgeKind(str(edge.get("kind") or "")),
                    float(edge.get("weight", 1.0)),
                    **props,
                )
            )


def observations_to_records(observations: Iterable[Observation]) -> list[dict[str, Any]]:
    """Convert node observations into ``KGStore.record_observations`` dicts."""
    records = []
    for observation in iter_node_observations(observations):
        record = dict(observation.data, kind=observation.kind)
        record["props"] = _props_with_provenance(observation)
        records.append(record)
    return records
