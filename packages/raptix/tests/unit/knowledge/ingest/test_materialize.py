"""Provenance propagation from ``Observation`` into materialized KG writes.

``ParserRegistry`` stamps every observation with ``source_artifact_id`` /
``parser_id`` (packages/raptix/raptix/knowledge/ingest/registry.py
``_stamp``); these tests pin that the two materializers actually carry
those fields through to the graph write instead of silently dropping them.
"""

from __future__ import annotations

from raptix.knowledge.ingest.materialize import apply_observations, observations_to_records
from raptix_core.types.capability import Observation
from raptix_core.types.kg import KnowledgeGraph, NodeKind


def _stamped(
    *,
    key: str = "host::10.0.0.1",
    props: dict | None = None,
    source_artifact_id: str | None = "artifact::abc123",
    parser_id: str | None = "nmap_xml",
    confidence: float = 0.42,
) -> Observation:
    return Observation(
        kind=NodeKind.HOST.value,
        data={"key": key, "label": "10.0.0.1", "props": props or {}},
        source_artifact_id=source_artifact_id,
        parser_id=parser_id,
        confidence=confidence,
    )


class TestApplyObservationsProvenance:
    def test_source_artifact_id_and_parser_id_land_on_the_node(self) -> None:
        graph = KnowledgeGraph()
        apply_observations(graph, [_stamped()])
        (node,) = graph.nodes.values()
        assert node.props["source_artifact_id"] == "artifact::abc123"
        assert node.props["parser_id"] == "nmap_xml"

    def test_confidence_is_not_propagated(self) -> None:
        graph = KnowledgeGraph()
        apply_observations(graph, [_stamped()])
        (node,) = graph.nodes.values()
        assert "confidence" not in node.props

    def test_existing_domain_confidence_prop_is_preserved(self) -> None:
        """Regression guard: slither_json already writes a domain-specific
        props["confidence"] string (Low/Medium/High). Materializing must
        never overwrite it with the parser's float confidence."""
        graph = KnowledgeGraph()
        apply_observations(graph, [_stamped(props={"confidence": "Medium"})])
        (node,) = graph.nodes.values()
        assert node.props["confidence"] == "Medium"

    def test_unstamped_observation_omits_provenance_keys(self) -> None:
        graph = KnowledgeGraph()
        apply_observations(graph, [_stamped(source_artifact_id=None, parser_id=None)])
        (node,) = graph.nodes.values()
        assert "source_artifact_id" not in node.props
        assert "parser_id" not in node.props

    def test_input_observation_data_is_not_mutated(self) -> None:
        observation = _stamped(props={"existing": "value"})
        original_props = dict(observation.data["props"])
        apply_observations(KnowledgeGraph(), [observation])
        assert observation.data["props"] == original_props


class TestObservationsToRecordsProvenance:
    def test_source_artifact_id_and_parser_id_land_in_record_props(self) -> None:
        (record,) = observations_to_records([_stamped()])
        assert record["props"]["source_artifact_id"] == "artifact::abc123"
        assert record["props"]["parser_id"] == "nmap_xml"

    def test_confidence_is_not_propagated(self) -> None:
        (record,) = observations_to_records([_stamped()])
        assert "confidence" not in record["props"]

    def test_existing_domain_confidence_prop_is_preserved(self) -> None:
        (record,) = observations_to_records([_stamped(props={"confidence": "High"})])
        assert record["props"]["confidence"] == "High"

    def test_unstamped_observation_omits_provenance_keys(self) -> None:
        (record,) = observations_to_records([_stamped(source_artifact_id=None, parser_id=None)])
        assert "source_artifact_id" not in record["props"]
        assert "parser_id" not in record["props"]

    def test_input_observation_data_is_not_mutated(self) -> None:
        observation = _stamped(props={"existing": "value"})
        original_props = dict(observation.data["props"])
        observations_to_records([observation])
        assert observation.data["props"] == original_props

    def test_summary_observations_are_skipped(self) -> None:
        summary = Observation(kind="parse.summary", data={"hosts": 3})
        assert observations_to_records([summary, _stamped()]) == observations_to_records(
            [_stamped()]
        )
