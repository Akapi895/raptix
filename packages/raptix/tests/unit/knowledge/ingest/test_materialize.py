"""Provenance propagation from ``Observation`` into materialized KG writes.

``ParserRegistry`` stamps every observation with ``source_artifact_id`` /
``parser_id`` (packages/raptix/raptix/knowledge/ingest/registry.py
``_stamp``); these tests pin that the two materializers actually carry
those fields through to the graph write instead of silently dropping them.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from raptix.knowledge.graph.asset_identity import identity_for
from raptix.knowledge.graph.ingest import _adapt_nmap_xml
from raptix.knowledge.ingest.materialize import apply_observations, observations_to_records
from raptix.knowledge.ingest.registry import default_registry
from raptix_core.types.capability import Artifact, Observation
from raptix_core.types.kg import KnowledgeGraph, NodeKind


class _CapturingStore:
    """Stands in for KGStore and keeps the observations the legacy adapter hands over."""

    def __init__(self) -> None:
        self.calls: list[list[dict[str, Any]]] = []

    def record_observations(
        self,
        observations: list[dict[str, Any]],
        *,
        engagement: str,
        created_by: str,
        source_episode_id: str,
    ) -> dict[str, Any]:
        self.calls.append(list(observations))
        return {"created": 0, "merged": 0, "edges": 0, "revision": "capture"}


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


_NMAP_FIXTURE = (
    Path(__file__).resolve().parents[6]
    / "apps"
    / "web"
    / "tests"
    / "fixtures"
    / "asset-map"
    / "network"
    / "htb-lab"
    / "retained-03-services.xml"
)


_COMPLETE_NMAP = sorted(
    path
    for path in (Path(__file__).resolve().parents[6] / "apps/web/tests/fixtures/asset-map/network").rglob("*.xml")
    if "</nmaprun>" in path.read_text(encoding="utf-8", errors="replace")
)


def _shape(records: list[dict[str, Any]]) -> tuple[set[str], set[str], set[tuple[str, str, str]]]:
    """Service keys, origin keys and Host edges: what the inspector and the origin map read."""
    services = {record["key"] for record in records if record["kind"] == "Service"}
    entrypoints = {record["key"] for record in records if record["kind"] == "Entrypoint"}
    edges = {
        (record["key"], edge["kind"], edge["to_key"])
        for record in records
        if record["kind"] == "Host"
        for edge in record.get("edges_out", [])
    }
    return services, entrypoints, edges


class TestRegistryAndLegacyWritersAgree:
    """The registry parser and the legacy adapter must give one host one asset identity (ADR-0094)."""

    def test_nmap_hosts_get_the_same_identity_from_both_writers(self) -> None:
        legacy = _CapturingStore()
        result = _adapt_nmap_xml(_NMAP_FIXTURE, legacy, "htb-lab", "retained", "ep")  # type: ignore[arg-type]
        assert "error" not in result
        legacy_ids = {
            obs["key"]: obs["props"]["asset_id"] for obs in legacy.calls[0] if obs["kind"] == "Host"
        }

        artifact = Artifact(
            id="retained-03", artifact_ref="artifact://retained-03", format_hint="nmap_xml"
        )
        outcome = default_registry().parse(
            artifact, _NMAP_FIXTURE.read_bytes(), expected_formats=("nmap_xml",)
        )
        registry_ids = {
            record["key"]: identity_for("htb-lab", "Host", record["key"], record["props"])[
                "asset_id"
            ]
            for record in observations_to_records(outcome.observations)
            if record["kind"] == "Host"
        }

        assert legacy_ids
        assert registry_ids == legacy_ids

    @pytest.mark.parametrize("path", _COMPLETE_NMAP, ids=lambda path: path.name)
    def test_services_web_origins_and_edges_have_the_same_shape_from_both_writers(self, path: Path) -> None:
        legacy = _CapturingStore()
        _adapt_nmap_xml(path, legacy, "htb-lab", "retained", "ep")  # type: ignore[arg-type]
        outcome = default_registry().parse(
            Artifact(id=path.stem, artifact_ref=f"artifact://{path.stem}", format_hint="nmap_xml"),
            path.read_bytes(),
            expected_formats=("nmap_xml",),
        )
        assert _shape(legacy.calls[0]) == _shape(observations_to_records(outcome.observations))
        services, entrypoints, edges = _shape(legacy.calls[0])
        # The inspector reads Host -HOSTS-> Service; origins hang off their host with HAS.
        assert {kind for _, kind, _ in edges} <= {"HOSTS", "HAS"}
        assert {to for _, kind, to in edges if kind == "HOSTS"} == services
        assert {to for _, kind, to in edges if kind == "HAS"} == entrypoints
