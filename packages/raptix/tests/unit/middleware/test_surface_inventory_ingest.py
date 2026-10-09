from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import ToolMessage

from raptix.knowledge.graph.ingest import (
    _adapt_arjun_json,
    _adapt_katana_jsonl,
    available_scanners,
)
from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware
from raptix.execution.session.recording import RecordingMiddleware, ReplayMiddleware


class _StubStore:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def record_observations(
        self,
        observations: list[dict[str, Any]],
        *,
        engagement: str,
        created_by: str,
        source_episode_id: str,
    ) -> dict[str, int]:
        self.calls.append(
            {
                "observations": observations,
                "engagement": engagement,
                "created_by": created_by,
                "source_episode_id": source_episode_id,
            }
        )
        return {"created": len(observations), "merged": 0, "edges": 0}


class _Sandbox:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.downloaded: list[str] = []

    def ls_info(self, directory: str) -> list[dict[str, Any]]:
        return [{"path": f"{directory}/katana.jsonl", "size": len(self.content)}]

    def download_files(self, paths: list[str]) -> list[Any]:
        self.downloaded.extend(paths)
        return [SimpleNamespace(content=self.content, error=None)]


def test_katana_adapter_records_endpoint_and_query_parameter(tmp_path: Path) -> None:
    output = tmp_path / "katana.jsonl"
    output.write_text(
        json.dumps(
            {
                "endpoint": "https://app.example.test/users?id=7",
                "method": "GET",
                "status_code": 200,
            }
        ),
        encoding="utf-8",
    )
    store = _StubStore()

    result = _adapt_katana_jsonl(output, store, "eng-1", "recon", "episode-1")

    assert "katana_jsonl" in available_scanners()
    assert result["endpoints"] == 1
    observations = store.calls[0]["observations"]
    endpoint = next(item for item in observations if item["kind"] == "Endpoint")
    parameter = next(item for item in observations if item["kind"] == "Parameter")
    assert endpoint["props"] == {
        "method": "GET",
        "url": "https://app.example.test/users?id=7",
        "path": "/users",
        "host": "app.example.test",
        "source": "katana",
        "status_code": 200,
    }
    assert parameter["props"]["name"] == "id"
    assert parameter["props"]["location"] == "query"
    assert parameter["edges_out"] == []
    assert {edge["to_key"] for edge in endpoint["edges_out"]} == {parameter["key"]}


def test_arjun_adapter_records_discovered_parameters(tmp_path: Path) -> None:
    output = tmp_path / "arjun.json"
    output.write_text(
        json.dumps(
            {
                "url": "https://app.example.test/search",
                "method": "GET",
                "params": ["q", "page"],
            }
        ),
        encoding="utf-8",
    )
    store = _StubStore()

    result = _adapt_arjun_json(output, store, "eng-1", "recon", "episode-2")

    assert "arjun_json" in available_scanners()
    assert result["endpoints"] == 1
    assert result["parameters"] == 2
    observations = store.calls[0]["observations"]
    assert {item["label"] for item in observations if item["kind"] == "Parameter"} == {
        "q",
        "page",
    }
    assert store.calls[0]["source_episode_id"] == "episode-2"


@pytest.mark.asyncio
async def test_katana_autoingest_replay_writes_inventory_without_live_tool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RAPTIX_KG_AUTOINGEST", "1")
    content = (
        json.dumps({"endpoint": "https://app.example.test/search?q=one", "method": "GET"}) + "\n"
    ).encode()
    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        tool_call={
            "id": "katana-1",
            "args": {
                "command": "katana -jsonl -o /workspace/katana.jsonl https://app.example.test"
            },
        },
        state={"engagement_name": "eng-1", "workspace_path": "/workspace"},
    )
    result = ToolMessage(
        content="crawl complete\n[Exit code: 0]", name="bash", tool_call_id="katana-1"
    )
    transcript = tmp_path / "recon-replay.jsonl"
    recorder = RecordingMiddleware(path=transcript)
    recorder.wrap_tool_call(request, lambda _request: result)
    assert recorder._sink is not None
    recorder._sink.close()

    replay = ReplayMiddleware(path=transcript, strict=True)
    store = _StubStore()
    hook = KGAutoIngestMiddleware(store=store, sandbox=_Sandbox(content), role="recon")

    async def live_handler(_request: Any) -> Any:
        raise AssertionError("live scanner must not run during replay")

    async def replay_handler(replay_request: Any) -> Any:
        return await replay.awrap_tool_call(replay_request, live_handler)

    returned = await hook.awrap_tool_call(request, replay_handler)

    assert returned.content == result.content
    assert len(store.calls) == 1
    observations = store.calls[0]["observations"]
    assert any(item["kind"] == "Endpoint" for item in observations)
    assert any(item["kind"] == "Parameter" for item in observations)
    assert store.calls[0]["source_episode_id"] == "katana-1"
