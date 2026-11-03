"""Run-local graph auto-capture settings survive assembly context teardown."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from langchain.agents import AgentState, create_agent
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool

from raptix.intelligence.agents.configured_graphs import _build_graph, assemble_graph
from raptix.intelligence.agents.middleware_slots import (
    _make_kg_autoingest,
    _make_tried_edges,
    graph_toggles_context,
)
from raptix.intelligence.agents.specialist_configuration import Assembly, ConfigurationError
from raptix.knowledge.graph.store import KGStore


class ProbeState(AgentState):
    engagement_name: str
    workspace_path: str
    target_value: str


class ProbeModel(FakeMessagesListChatModel):
    def bind_tools(self, tools: Any, **kwargs: Any) -> ProbeModel:
        return self


class CaptureStore:
    def __init__(self) -> None:
        self.observations: list[str] = []
        self.attempts: list[str] = []

    def record_observations(self, observations: Any, **scope: Any) -> dict[str, Any]:
        self.observations.append(scope["engagement"])
        return {"created": len(observations), "merged": 0, "edges": 0}

    def execute_write(self, cypher: str, params: Any, *, engagement: str) -> list:
        self.attempts.append(engagement)
        return []

    def execute_read(self, cypher: str, params: Any, *, engagement: str) -> list:
        return []


@pytest.mark.parametrize(
    "auto_ingest,tried_edges", [(True, True), (True, False), (False, True), (False, False)]
)
async def test_project_settings_control_real_agent_hooks_after_assembly(
    monkeypatch: pytest.MonkeyPatch, auto_ingest: bool, tried_edges: bool
) -> None:
    # Deliberately oppose the project settings to catch a second env-only gate.
    monkeypatch.setenv("RAPTIX_KG_AUTOINGEST", str(int(not auto_ingest)))
    monkeypatch.setenv("RAPTIX_KG_TRIED_EDGES", str(int(not tried_edges)))
    store = CaptureStore()
    monkeypatch.setattr(KGStore, "from_env", lambda: store)
    fixture = Path(__file__).parents[2] / "fixtures/real_scanner_output/nmap.xml"
    sandbox = SimpleNamespace(
        ls_info=lambda directory: [{"path": "/workspace/nmap.xml", "size": fixture.stat().st_size}],
        download_files=lambda paths, **kwargs: [
            SimpleNamespace(content=fixture.read_bytes(), error=None)
        ],
    )
    monkeypatch.setattr(
        "raptix.execution.backends.factory.build_sandbox_backend", lambda config: sandbox
    )

    @tool
    def bash(command: str) -> str:
        """Return a completed local scanner execution for the capture probe."""
        return "scan finished\n[Exit code: 0]"

    def factory() -> Any:
        hooks = [
            _make_tried_edges(role="recon"),
            _make_kg_autoingest(role="recon", sandbox=sandbox),
        ]
        model = ProbeModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "bash",
                            "id": "scan-1",
                            "args": {"command": "nmap -oX /workspace/nmap.xml 127.0.0.1"},
                        }
                    ],
                ),
                AIMessage(content="capture complete"),
            ]
        )
        return create_agent(
            model,
            tools=[bash],
            middleware=[hook for hook in hooks if hook is not None],
            state_schema=ProbeState,
        )

    graph, other_graph = await asyncio.gather(
        asyncio.to_thread(
            _build_graph,
            "recon",
            {"recon": factory},
            Assembly(),
            {},
            {"auto_ingest_enabled": auto_ingest, "tried_edges_enabled": tried_edges},
        ),
        asyncio.to_thread(
            _build_graph,
            "recon",
            {"recon": factory},
            Assembly(),
            {},
            {"auto_ingest_enabled": False, "tried_edges_enabled": False},
        ),
    )
    assert graph_toggles_context.get() is None
    outcome = await graph.ainvoke(
        {
            "messages": [("user", "Read the captured scan")],
            "engagement_name": "project-a",
            "workspace_path": "/workspace",
            "target_value": "127.0.0.1",
        }
    )
    assert outcome["messages"][-1].content == "capture complete"
    await other_graph.ainvoke(
        {
            "messages": [("user", "Read the captured scan")],
            "engagement_name": "project-b",
            "workspace_path": "/workspace",
            "target_value": "127.0.0.1",
        }
    )
    assert any(isinstance(message, ToolMessage) for message in outcome["messages"])
    assert bool(store.observations) is auto_ingest
    assert bool(store.attempts) is tried_edges
    assert set(store.observations + store.attempts) <= {"project-a"}


@pytest.mark.parametrize(
    "settings",
    ["false", [], {"auto_ingest_enabled": "false"}, {"tried_edges_enabled": 1}, {"unknown": True}],
)
async def test_invalid_project_settings_are_rejected_before_graph_assembly(settings: Any) -> None:
    with pytest.raises(ConfigurationError, match="graph_toggles"):
        await assemble_graph("recon", {"configurable": {"graph_toggles": settings}})
    assert graph_toggles_context.get() is None


def test_failed_assembly_restores_outer_project_settings() -> None:
    outer = {"auto_ingest_enabled": False, "tried_edges_enabled": True}
    token = graph_toggles_context.set(outer)

    def failing_factory() -> None:
        raise ConfigurationError("assembly probe failed")

    try:
        with pytest.raises(ConfigurationError, match="assembly probe failed"):
            _build_graph(
                "recon",
                {"recon": failing_factory},
                Assembly(),
                {},
                {
                    "auto_ingest_enabled": True,
                    "tried_edges_enabled": False,
                },
            )
        assert graph_toggles_context.get() is outer
    finally:
        graph_toggles_context.reset(token)
