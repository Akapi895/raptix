"""Project-selected hooks capture observations and attempts in real Neo4j."""

from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.messages import ToolMessage

from raptix.intelligence.agents.configured_graphs import _build_graph
from raptix.intelligence.agents.middleware_slots import (
    _make_kg_autoingest,
    _make_tried_edges,
    graph_toggles_context,
)
from raptix.intelligence.agents.specialist_configuration import Assembly
from raptix.knowledge.graph.store import KGStore


@pytest.mark.parametrize("enabled", [True, False])
async def test_project_choice_overrides_env_for_live_graph_writes(
    kgstore: KGStore, engagement: str, monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    monkeypatch.setenv("RAPTIX_KG_AUTOINGEST", str(int(not enabled)))
    monkeypatch.setenv("RAPTIX_KG_TRIED_EDGES", str(int(not enabled)))
    monkeypatch.setattr(KGStore, "from_env", lambda: kgstore)
    content = (Path(__file__).parents[2] / "fixtures/real_scanner_output/nmap.xml").read_bytes()
    sandbox = SimpleNamespace(
        ls_info=lambda directory: [{"path": "/workspace/nmap.xml", "size": len(content)}],
        download_files=lambda paths, **kwargs: [SimpleNamespace(content=content, error=None)],
    )

    def factory() -> list:
        return [_make_kg_autoingest(role="recon", sandbox=sandbox), _make_tried_edges(role="recon")]

    hooks = _build_graph(
        "recon",
        {"recon": factory},
        Assembly(),
        {},
        {
            "auto_ingest_enabled": enabled,
            "tried_edges_enabled": enabled,
        },
    )
    assert graph_toggles_context.get() is None
    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        tool_call={
            "id": "toggle-live-1",
            "args": {"command": "nmap -oX /workspace/nmap.xml 127.0.0.1"},
        },
        state={
            "engagement_name": engagement,
            "workspace_path": "/workspace",
            "target_value": "127.0.0.1",
        },
    )
    result = ToolMessage(content="scan complete\n[Exit code: 0]", tool_call_id="toggle-live-1")

    async def handler(request: object) -> ToolMessage:
        return result

    for hook in hooks:
        if hook is not None:
            assert await hook.awrap_tool_call(request, handler) is result
    hosts = kgstore.execute_read(
        "MATCH (n:Host {engagement: $engagement}) RETURN count(n) AS count", engagement=engagement
    )
    attempts = kgstore.execute_read(
        "MATCH ()-[r:MAPS_TO {engagement: $engagement, tried_ledger: true}]->() RETURN count(r) AS count",
        engagement=engagement,
    )
    assert (hosts[0]["count"] > 0) is enabled
    assert (attempts[0]["count"] > 0) is enabled
