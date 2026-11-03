"""Exercise the new graph boundaries against the live integration fixture."""

import json

import pytest

from raptix.knowledge.graph.migration_runner import apply_migrations
from raptix.knowledge.graph.query import GraphQuery, query_runtime
from raptix.knowledge.reference.loader import ingest_corpus, read_corpus
from raptix.knowledge.reference.query import query_reference


def test_agent_write_cannot_launder_tool_properties(kgstore, engagement):
    apply_migrations(kgstore)
    kgstore.record_observations(
        [
            {"kind": "Host", "key": "host::trusted", "props": {"hostname": "real", "status": "up"}},
        ],
        engagement=engagement,
        created_by="recon",
        source_episode_id="scan-1",
        provenance_channel="tool_autoingest",
    )
    kgstore.record_observations(
        [
            {
                "kind": "Host",
                "key": "host::trusted",
                "props": {
                    "hostname": "forged",
                    "key": "escape",
                    "provenance_channel": "tool_autoingest",
                },
            },
        ],
        engagement=engagement,
        created_by="exploit",
        source_episode_id="claim-1",
        provenance_channel="agent_authored",
    )
    query = GraphQuery(query_type="observation", params={"kind": "Host", "key": "host::trusted"})
    node = query_runtime(kgstore, engagement, query)["nodes"][0]
    assert node["props"]["hostname"] == "real"
    assert node["props"]["source_episode_id"] == "scan-1"
    assert node["props"]["provenance_channel"] == "tool_autoingest"
    assert query_runtime(kgstore, engagement + "-other", query)["nodes"] == []


def test_upgrading_trust_does_not_preserve_invented_properties(kgstore, engagement):
    kgstore.record_observations(
        [{"kind": "Host", "key": "host::upgrade", "props": {"status": "compromised"}}],
        engagement=engagement,
        created_by="agent",
        source_episode_id="claim",
        provenance_channel="agent_authored",
    )
    kgstore.record_observations(
        [{"kind": "Host", "key": "host::upgrade", "props": {"hostname": "observed"}}],
        engagement=engagement,
        created_by="recon",
        source_episode_id="scan",
        provenance_channel="tool_autoingest",
    )
    node = query_runtime(
        kgstore,
        engagement,
        GraphQuery(query_type="observation", params={"kind": "Host", "key": "host::upgrade"}),
    )["nodes"][0]
    assert "status" not in node["props"]


def test_internal_query_requires_runtime_authentication(kgstore, engagement):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from raptix.interfaces.api.kg_query_routes import router

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    body = {"engagement": engagement, "query_type": "search", "params": {"kind": "Host"}}
    assert client.post("/_raptix/kg/query", json=body).status_code == 401
    headers = {"authorization": "Bearer test-runtime-token-0123456789abcdef"}
    assert client.post("/_raptix/kg/query", json=body, headers=headers).status_code == 200
    body["engagement"] = "schema"
    assert client.post("/_raptix/kg/query", json=body, headers=headers).status_code == 403


def test_reference_ingestion_is_idempotent_and_keeps_unresolved_edges(kgstore, tmp_path):
    apply_migrations(kgstore)
    for name, record in {
        "cwe.yaml": {
            "id": "cwe:CWE-test",
            "source": "cwe",
            "type": "weakness",
            "name": "Test weakness",
        },
        "capec.yaml": {
            "id": "capec:CAPEC-test",
            "source": "capec",
            "type": "attack_pattern",
            "name": "Test pattern",
            "relationships": [
                {
                    "source_id": "capec:CAPEC-test",
                    "target_id": "cwe:CWE-test",
                    "type": "related_weakness",
                },
                {"source_id": "capec:CAPEC-test", "target_id": "nvd:CVE-test", "type": "enriches"},
            ],
        },
    }.items():
        (tmp_path / name).write_text(json.dumps(record), encoding="utf-8")
    records, report = read_corpus(tmp_path)
    first = ingest_corpus(kgstore, records, report, allow_partial=True)
    second = ingest_corpus(kgstore, records, report, allow_partial=True)
    assert first["errors"] == []
    assert second["created"] == 0
    query = GraphQuery(graph="reference", query_type="neighbors", params={"id": "capec:CAPEC-test"})
    graph = query_reference(kgstore, query)
    assert {node["id"] for node in graph["nodes"]} == {
        "capec:CAPEC-test",
        "cwe:CWE-test",
        "nvd:CVE-test",
    }
    assert any(edge["resolution_status"] == "external_unresolved" for edge in graph["edges"])


@pytest.mark.parametrize("kind", ["KrgReference", "KGRevision", "MigrationLog", "Skill"])
def test_observation_writer_refuses_other_graph_namespaces(kgstore, engagement, kind):
    with pytest.raises(ValueError):
        kgstore.record_observations(
            [{"kind": kind, "key": "bad"}],
            engagement=engagement,
            created_by="agent",
            source_episode_id="claim",
            provenance_channel="agent_authored",
        )
