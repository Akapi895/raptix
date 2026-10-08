"""Wave T4 semantic KG read tools — search_knowledge / inspect_asset / find_attack_paths.

These three @tool projections replaced the agent-facing kg_query /
kg_neighbors / kg_stats CRUD surface. Unit-tested here against the same
in-memory _FakeStore the tools.py suites use; agent-facing behavior
(.invoke), ranking, filters, and error paths.

find_attack_paths delegates to chain.plan_chains (APOC dijkstra) — its
mechanics are covered by test_chain.py; here we pin the serialization
contract (Chain.to_dict + critical-path score) and argument clamping
via a stubbed plan_chains.
"""

from __future__ import annotations

import json

import pytest

from raptix.execution.tools.research import _state as state
from raptix.execution.tools.research import tools as research_tools
from raptix.execution.tools.research.chain import Chain, ChainStep
from raptix.execution.tools.research.semantic import (
    find_attack_paths,
    inspect_asset,
    search_knowledge,
)
from raptix.knowledge.ingest.parsers.nmap_xml import _is_web_port  # noqa: F401
from raptix_core.types.kg import KnowledgeGraph, NodeKind, Severity  # noqa: F401

# ── Shared fake store (mirrors test_tools_extended.py) ──────────────────


class _FakeStore:
    """In-memory fake Neo4j store for unit tests."""

    def __init__(self) -> None:
        self.graph = KnowledgeGraph()

    def load_graph(self):
        return self.graph.model_copy(deep=True)

    def batch_upsert_nodes(self, nodes):
        for n in nodes:
            self.graph.upsert_node(n)
        return len(nodes)

    def batch_upsert_edges(self, edges):
        for e in edges:
            self.graph.upsert_edge(e)
        return len(edges)

    def ensure_schema(self):
        pass

    def close(self):
        pass

    def revision(self):
        return 0.0

    def stats(self):
        return self.graph.stats()

    def upsert_node(self, node):
        self.graph.upsert_node(node)

    def upsert_edge(self, edge):
        self.graph.upsert_edge(edge)

    def query_custom(self, cypher, params):
        return []


def _configure_kg(monkeypatch: pytest.MonkeyPatch) -> _FakeStore:
    fake = _FakeStore()
    monkeypatch.setattr(state, "_store", fake)
    return fake


# ── search_knowledge ────────────────────────────────────────────────────


class TestSearchKnowledge:
    def test_query_shorter_than_two_chars_returns_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _configure_kg(monkeypatch)
        result = json.loads(search_knowledge.invoke({"query": "a"}))
        assert "error" in result

    def test_label_match_found_case_insensitively(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _configure_kg(monkeypatch)
        research_tools.kg_add_node(kind="Host", label="WEB-tomcat-01")
        research_tools.kg_add_node(kind="Host", label="irrelevant")
        result = json.loads(search_knowledge.invoke({"query": "TOMCAT"}))
        assert result["total"] == 1
        assert result["results"][0]["label"] == "WEB-tomcat-01"

    def test_prop_match_ranked_after_label_match(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _configure_kg(monkeypatch)
        research_tools.kg_add_node(kind="Host", label="plain-box")
        research_tools.kg_add_node(kind="Host", label="tomcat-host")
        research_tools.kg_add_node(kind="Technology", label="framework", props='{"name": "tomcat"}')
        result = json.loads(search_knowledge.invoke({"query": "tomcat"}))
        assert result["total"] == 2
        # Label matches rank ahead of property matches.
        assert result["results"][0]["label"] == "tomcat-host"
        assert result["results"][1]["label"] == "framework"

    def test_kind_filter_restricts_results(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _configure_kg(monkeypatch)
        research_tools.kg_add_node(kind="Host", label="tomcat-a")
        research_tools.kg_add_node(kind="Vulnerability", label="tomcat-b")
        result = json.loads(search_knowledge.invoke({"query": "tomcat", "kind": "Host"}))
        assert result["total"] == 1
        assert result["results"][0]["kind"] == "Host"

    def test_unknown_kind_returns_error_with_valid_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _configure_kg(monkeypatch)
        result = json.loads(search_knowledge.invoke({"query": "xy", "kind": "notakind"}))
        assert "error" in result
        assert "valid" in result
        assert "Host" in result["valid"]

    def test_limit_applied_to_results(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _configure_kg(monkeypatch)
        for i in range(5):
            research_tools.kg_add_node(kind="Host", label=f"srv-{i}")
        result = json.loads(search_knowledge.invoke({"query": "srv", "limit": 2}))
        assert result["total"] == 5
        assert result["returned"] == 2
        assert len(result["results"]) == 2


# ── inspect_asset ───────────────────────────────────────────────────────


class TestInspectAsset:
    def test_projects_asset_with_props(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = _configure_kg(monkeypatch)
        research_tools.kg_add_node(kind="Host", label="web01", props='{"os": "linux"}')
        host_id = next(iter(fake.graph.nodes))
        result = json.loads(inspect_asset.invoke({"node_id": host_id}))
        assert result["asset"]["label"] == "web01"
        assert result["asset"]["props"] == {"os": "linux"}

    def test_outgoing_edge_appears_in_neighbors_out(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = _configure_kg(monkeypatch)
        research_tools.kg_add_node(kind="Host", label="web01")
        host_id = next(iter(fake.graph.nodes))
        research_tools.kg_add_node(kind="Vulnerability", label="CVE-2024-0001")
        vuln_id = list(fake.graph.nodes)[1]
        research_tools.kg_add_edge(src=host_id, dst=vuln_id, kind="HAS_VULN")

        result = json.loads(inspect_asset.invoke({"node_id": host_id}))
        assert len(result["neighbors_out"]) == 1
        assert result["neighbors_out"][0]["id"] == vuln_id
        assert result["neighbors_out"][0]["edge_kind"] == "HAS_VULN"

        reverse = json.loads(inspect_asset.invoke({"node_id": vuln_id}))
        assert len(reverse["neighbors_in"]) == 1
        assert reverse["neighbors_in"][0]["id"] == host_id

    def test_unknown_node_returns_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _configure_kg(monkeypatch)
        result = json.loads(inspect_asset.invoke({"node_id": "missing-node"}))
        assert result["error"] == "node not found"


# ── find_attack_paths ────────────────────────────────────────────────────


def _stub_plan_chains(monkeypatch: pytest.MonkeyPatch, chains: list[Chain]) -> list[dict]:
    """Patch semantic's plan_chains binding; record the kwargs it receives."""
    recorded: list[dict] = []

    def fake_plan_chains(**kwargs):
        recorded.append(kwargs)
        return chains

    monkeypatch.setattr("raptix.execution.tools.research.semantic.plan_chains", fake_plan_chains)
    return recorded


class TestFindAttackPaths:
    @staticmethod
    def _chain() -> Chain:
        return Chain(
            entrypoint_id="e1",
            entrypoint_label="https://app/",
            crown_jewel_id="cj1",
            crown_jewel_label="domain_admin",
            steps=[
                ChainStep(
                    node_id="n1",
                    node_label="web01",
                    node_kind="Host",
                    edge_kind="EXPLOITS",
                    hop_cost=1.0,
                )
            ],
            total_cost=1.5,
        )

    def test_serializes_chains_with_score(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # critical_path_score consults get_store() for worst-hop severity,
        # so a fake store must be registered even though no vuln nodes
        # are present in this chain.
        _configure_kg(monkeypatch)
        _stub_plan_chains(monkeypatch, [self._chain()])
        result = json.loads(find_attack_paths.invoke({}))
        assert result["count"] == 1
        chain = result["chains"][0]
        assert chain["entrypoint"] == "https://app/"
        assert chain["crown_jewel"] == "domain_admin"
        assert "score" in chain
        # score = round(0.6 * (1 / max(total_cost, 0.1)) * 10 + 0.4 * 0, 2)
        assert chain["score"] == pytest.approx(4.0)

    def test_arguments_passed_through_and_clamped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _configure_kg(monkeypatch)
        recorded = _stub_plan_chains(monkeypatch, [])
        find_attack_paths.invoke({"top_k": 999, "max_depth": -3, "max_cost": 5.0})
        assert len(recorded) == 1
        kwargs = recorded[0]
        assert kwargs["top_k"] == 20
        assert kwargs["max_depth"] == 1
        assert kwargs["max_cost"] == 5.0
