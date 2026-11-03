"""A saved disabled preference removes assistance, not observation writes or scope."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from langchain_core.messages import SystemMessage

from raptix.intelligence.agents.configured_graphs import _build_graph
from raptix.intelligence.agents.middleware_slots import _make_kg, knowledge_graph_context
from raptix.intelligence.agents.specialist_configuration import Assembly
from raptix.knowledge.graph.store import KGStore


def test_execution_snapshot_removes_graph_reads_and_context_but_keeps_scoped_writes(
    monkeypatch,
) -> None:
    store = MagicMock()
    monkeypatch.setattr(KGStore, "from_env", lambda: store)
    disabled = _build_graph(
        "recon", {"recon": lambda: _make_kg(role="recon")}, Assembly(), {}, None, False
    )
    enabled = _build_graph(
        "recon", {"recon": lambda: _make_kg(role="recon")}, Assembly(), {}, None, True
    )
    assert {t.name for t in disabled.tools} == {"kg_record", "kg_ingest"}
    assert {"kg_query", "kg_query_reference"} <= {t.name for t in enabled.tools}
    assert disabled.before_agent({"engagement_name": "project-a"}, None) == {
        "kg_engagement": "project-a"
    }
    request = SimpleNamespace(
        state={"kg_engagement": "project-a", "kg_summary": "graph summary"},
        system_message=SystemMessage(content="base"),
    )
    assert disabled.wrap_model_call(request, lambda req: req) is request
    store.revision.assert_not_called()
    assert knowledge_graph_context.get() is True
