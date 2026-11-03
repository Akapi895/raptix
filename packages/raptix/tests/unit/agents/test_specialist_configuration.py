"""Behavioral coverage for immutable additive specialist assembly."""

import asyncio
import json
import os
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

from raptix.intelligence.agents.specialist_configuration import Additions, ConfigurationError

SKILL = "/skills/standard/analyst/sql-injection/SKILL.md"


@pytest.mark.asyncio
async def test_specialist_description_uses_registered_task_metadata() -> None:
    from raptix.interfaces.api.specialist_routes import specialists
    from raptix_core.plugin_loader import load_subagents_for_parent

    recon = next(spec for spec in load_subagents_for_parent("raptix") if spec.name == "recon")
    response = await specialists()
    descriptor = next(s for s in response["specialists"] if s["id"] == "recon")
    assert descriptor["description"] == recon.description


class CapabilityProbe(GenericFakeChatModel):
    """Provider double that calls actual tools on the actual compiled graph."""

    role: str = "recon"
    offered: list[str] = Field(default_factory=list)
    expect_additions: bool = True
    started: Any = None
    release: Any = None

    def bind_tools(self, tools: list[Any], **kwargs: Any) -> Any:
        self.offered = [t.name for t in tools]
        return self

    def _generate(
        self, messages: list[Any], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        completed = [m for m in messages if isinstance(m, ToolMessage)]
        if completed:
            if self.role == "recon":
                results = {m.tool_call_id: str(m.content) for m in completed}
                assert "load_skill error" not in results["skill-probe"]
                assert "controlled-mcp:project-a" in results["mcp-probe"]
                assert "Error invoking" not in results["tool-probe"]
            answer = AIMessage(content="probe-complete")
        elif not self.expect_additions:
            answer = AIMessage(content="defaults-only")
        elif self.role == "raptix":
            answer = AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "task",
                        "args": {
                            "subagent_type": "recon",
                            "description": "Inspect local capability wiring only; return the loaded configuration.",
                        },
                        "id": "delegate-probe",
                    }
                ],
            )
        else:
            assert "solidity_scan" in self.offered
            mcp_name = next(n for n in self.offered if n.startswith("mcp_"))
            answer = AIMessage(
                content="",
                tool_calls=[
                    {"name": "load_skill", "args": {"skill_path": SKILL}, "id": "skill-probe"},
                    {
                        "name": "solidity_scan",
                        "args": {"source": "pragma solidity ^0.8.0; contract Empty {}"},
                        "id": "tool-probe",
                    },
                    {"name": mcp_name, "args": {"marker": "project-a"}, "id": "mcp-probe"},
                ],
            )
        return ChatResult(generations=[ChatGeneration(message=answer)])

    async def _agenerate(
        self, messages: list[Any], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        if self.started is not None:
            self.started.set()
            await self.release.wait()
        return self._generate(messages, stop, run_manager, **kwargs)


@pytest.fixture
def controlled_mcp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAPTIX_USE_SKILLOGY", "0")
    monkeypatch.setenv(
        "RAPTIX_MCP__SERVERS",
        json.dumps(
            {
                "controlled": {
                    "transport": "stdio",
                    "command": sys.executable,
                    "args": [str(Path(__file__).with_name("controlled_mcp_server.py"))],
                }
            }
        ),
    )


def snapshot(revision: int = 1) -> dict[str, Any]:
    return {
        "version": 1,
        "revision": revision,
        "project_id": "project-a",
        "specialists": {
            "recon": {
                "skills": [SKILL],
                "tools": ["tool:solidity_scan"],
                "mcp": ["mcp:controlled:echo_marker"],
                "global_revision": 0,
                "project_revision": revision,
            }
        },
    }


def test_duplicate_and_arbitrary_capability_ids_are_rejected() -> None:
    with pytest.raises(ValueError):
        Additions(tools=["tool:a", "tool:a"])
    with pytest.raises(ConfigurationError):
        Additions(tools=["not-a-tool"]).validate_ids({}, {}, {})


@pytest.mark.asyncio
async def test_controlled_mcp_discovery_has_no_secrets_and_only_selected_tool_is_loaded(
    controlled_mcp: None,
) -> None:
    from raptix.intelligence.agents.specialist_mcp import discover_mcp

    reports, tools = await discover_mcp()
    assert reports[0]["reachable"] is True
    assert set(tools) == {"mcp:controlled:echo_marker", "mcp:controlled:unselected_tool"}
    assert "command" not in json.dumps(reports)
    assert await tools["mcp:controlled:echo_marker"].ainvoke({"marker": "test"})


@pytest.mark.asyncio
async def test_direct_recon_executes_selected_skill_integrated_tool_and_mcp_without_removing_defaults(
    controlled_mcp: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from raptix.intelligence.agents.configured_graphs import assemble_graph

    model = CapabilityProbe(messages=iter([]))
    graph = await assemble_graph(
        "recon",
        {"configurable": {"specialist_configuration": snapshot()}},
        llm=model,
        fallback_models=[],
    )
    outcome = await graph.ainvoke(
        {
            "messages": [("user", "Run the local capability probe")],
            "engagement_name": "project-a",
            "workspace_path": "/workspace",
        }
    )
    evidence = outcome["specialist_configuration"]["recon"]
    assert evidence["revision"] == 1
    assert evidence["project_id"] == "project-a"
    assert {"bash", "load_skill", "solidity_scan"}.issubset(evidence["tools"])
    assert sum(n.startswith("mcp_") for n in evidence["tools"]) == 1
    results = {
        m.tool_call_id: str(m.content) for m in outcome["messages"] if isinstance(m, ToolMessage)
    }
    assert "load_skill error" not in results["skill-probe"]
    assert "controlled-mcp:project-a" in results["mcp-probe"]
    assert "Error invoking" not in results["tool-probe"]


@pytest.mark.asyncio
async def test_orchestrator_task_uses_same_snapshot_with_real_dispatch_and_fresh_graphs(
    controlled_mcp: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from raptix.intelligence.agents.configured_graphs import assemble_graph
    from raptix.intelligence.llm import LLMFactory

    models = {}

    def provider(self: Any, role: str) -> Any:
        model = CapabilityProbe(messages=iter([]), role=role)
        models[role] = model
        return model

    monkeypatch.setattr(LLMFactory, "get_model", provider)
    monkeypatch.setattr(LLMFactory, "get_fallback_models", lambda *_: [])
    graph = await assemble_graph(
        "raptix", {"configurable": {"specialist_configuration": snapshot()}}
    )
    outcome = await graph.ainvoke(
        {
            "messages": [("user", "Delegate the local capability probe to recon")],
            "engagement_name": "project-a",
            "workspace_path": "/workspace",
        }
    )
    assert outcome["messages"][-1].content == "probe-complete"
    assert "solidity_scan" in models["recon"].offered
    assert any(n.startswith("mcp_") for n in models["recon"].offered)
    assert "task" in models["raptix"].offered
    child_evidence = outcome["specialist_configuration"]["raptix"]["assembled_specialists"]["recon"]
    assert child_evidence["selection"] == snapshot()["specialists"]["recon"]
    assert child_evidence["project_id"] == "project-a"


@pytest.mark.asyncio
async def test_unknown_and_disconnected_mcp_fail_before_model_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from raptix.intelligence.agents.configured_graphs import assemble_graph

    monkeypatch.delenv("RAPTIX_MCP__SERVERS", raising=False)
    with pytest.raises(ConfigurationError, match="MCP tool"):
        await assemble_graph("recon", {"configurable": {"specialist_configuration": snapshot()}})


@pytest.mark.asyncio
async def test_running_graph_keeps_old_revision_while_new_run_and_project_b_are_isolated(
    controlled_mcp: None,
) -> None:
    from raptix.intelligence.agents.configured_graphs import assemble_graph

    started, release = asyncio.Event(), asyncio.Event()
    old_snapshot = snapshot()
    old = await assemble_graph(
        "recon",
        {"configurable": {"specialist_configuration": old_snapshot}},
        llm=CapabilityProbe(messages=iter([]), started=started, release=release),
        fallback_models=[],
    )
    task = asyncio.create_task(old.ainvoke({"messages": [("user", "probe")]}))
    await asyncio.wait_for(started.wait(), 5)
    changed = snapshot(2)
    changed["specialists"]["recon"]["tools"].append("tool:foundry_access_test")
    new = await assemble_graph(
        "recon",
        {"configurable": {"specialist_configuration": changed}},
        llm=CapabilityProbe(messages=iter([])),
        fallback_models=[],
    )
    release.set()
    previous = (await task)["specialist_configuration"]["recon"]
    current = (await new.ainvoke({"messages": [("user", "probe")]}))["specialist_configuration"][
        "recon"
    ]
    assert previous["revision"] == 1 and "foundry_access_test" not in previous["tools"]
    assert current["revision"] == 2 and "foundry_access_test" in current["tools"]
    default = await assemble_graph(
        "recon",
        {
            "configurable": {
                "specialist_configuration": {
                    "version": 1,
                    "revision": 2,
                    "project_id": "project-b",
                    "specialists": {},
                }
            }
        },
        llm=CapabilityProbe(messages=iter([]), expect_additions=False),
        fallback_models=[],
    )
    other = (await default.ainvoke({"messages": [("user", "probe")]}))["specialist_configuration"][
        "recon"
    ]
    assert "solidity_scan" not in other["tools"]
    assert all(not t.startswith("mcp_") for t in other["tools"])
    assert other["project_id"] == "project-b"


def test_every_selectable_specialist_has_a_real_shared_factory_inventory() -> None:
    from raptix.intelligence.agents.specialist_catalog import (
        builtin_inventory,
        specialist_factories,
    )

    for role in specialist_factories():
        inventory = builtin_inventory(role)
        assert "load_skill" in inventory["tools"], role
        assert inventory["skill_sources"], role


def test_runtime_catalog_auth_validation_and_documented_response_schema() -> None:
    import yaml
    from fastapi.testclient import TestClient
    from jsonschema import Draft202012Validator

    from raptix.interfaces.api.plugins_api import app

    client = TestClient(app)
    assert client.get("/_raptix/specialists/catalog?specialist_id=recon").status_code == 401
    token = Path(os.environ["RAPTIX_RUNTIME_API_TOKEN_FILE"]).read_text().strip()
    headers = {"Authorization": "Bearer " + token}
    response = client.get("/_raptix/specialists/catalog?specialist_id=recon", headers=headers)
    assert response.status_code == 200
    specification = yaml.safe_load(
        (Path(__file__).resolve().parents[5] / "docs/api/specialists.openapi.yaml").read_text()
    )
    Draft202012Validator(
        {"$ref": "#/components/schemas/Catalog", "components": specification["components"]}
    ).validate(response.json())
    invalid = client.post(
        "/_raptix/specialists/validate",
        headers=headers,
        json={
            "specialist_id": "recon",
            "additions": {"tools": ["arbitrary"], "skills": [], "mcp": []},
        },
    )
    assert invalid.status_code == 422
    unknown = client.get("/_raptix/specialists/catalog?specialist_id=nonexistent", headers=headers)
    assert unknown.status_code == 400


def test_mcp_aliases_do_not_evade_existing_name_based_approval_and_scope_rules() -> None:
    from langchain_core.messages import ToolMessage

    from raptix.middleware.hitl import (
        ApprovalPolicyRule,
        HITLApprovalMiddleware,
        InProcessApprovalTransport,
    )
    from raptix.middleware.roe import RoEGuardrailMiddleware

    request = SimpleNamespace(
        tool=SimpleNamespace(name="mcp_hashed_alias", metadata={"mcp_tool": "bash"}),
        tool_call={
            "name": "mcp_hashed_alias",
            "id": "controlled-call",
            "args": {"command": "curl http://192.0.2.7"},
        },
        state={},
    )
    gate = HITLApprovalMiddleware(
        policy=[ApprovalPolicyRule(tool_pattern="^bash$", timeout_seconds=0)],
        transport=InProcessApprovalTransport(),
    )
    executed = []

    def handler(request: Any) -> ToolMessage:
        executed.append(True)
        return ToolMessage(content="should not execute", tool_call_id="controlled-call")

    result = gate.wrap_tool_call(request, handler)
    assert result.status == "error" and not executed
    decision, _, policy_name = RoEGuardrailMiddleware()._evaluate(request)
    assert policy_name == "bash"
    assert not decision.allow


@pytest.mark.asyncio
async def test_mcp_worker_cancellation_and_timeout_finish_resource_cleanup() -> None:
    from raptix.intelligence.agents.specialist_mcp import mcp_io

    started, cleaned = threading.Event(), threading.Event()

    async def connection() -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cleaned.set()

    running = asyncio.create_task(mcp_io(connection, 30))
    assert await asyncio.to_thread(started.wait, 2)
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    assert cleaned.is_set()
    cleaned.clear()
    with pytest.raises(TimeoutError):
        await mcp_io(connection, 0.01)
    assert cleaned.is_set()


@pytest.mark.asyncio
async def test_invalid_mcp_configuration_is_reported_without_sensitive_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from raptix.intelligence.agents.specialist_mcp import discover_mcp

    monkeypatch.setenv("RAPTIX_MCP__SERVERS", "{secret-invalid-value")
    reports, tools = await discover_mcp()
    assert not tools
    assert reports[0]["configured"] is False
    assert reports[0]["status"] == "unavailable"
    assert "secret-invalid-value" not in json.dumps(reports)
