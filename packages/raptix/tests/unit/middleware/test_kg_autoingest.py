"""Post-tool KG ingestion preserves tool results and engagement scope."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from raptix.runtime.recording import RecordingMiddleware, ReplayMiddleware
from raptix_core.contracts.slots import SLOTS_PER_ROLE, MiddlewareSlot

NMAP_XML = b"""<nmaprun><host><status state="up"/><address addr="10.0.0.1" addrtype="ipv4"/>
<ports><port portid="80" protocol="tcp"><state state="open"/><service name="http"/>
</port></ports></host></nmaprun>"""


@pytest.fixture(autouse=True)
def _enable_autoingest(monkeypatch):
    monkeypatch.setenv("DECEPTICON_KG_AUTOINGEST", "1")


class _Store:
    def __init__(self) -> None:
        self.writes: list[dict] = []

    def record_observations(self, observations, **scope):
        self.writes.append({"observations": observations, **scope})
        return {"created": len(observations), "merged": 0, "edges": 0, "revision": "rev-1"}


class _Sandbox:
    def __init__(self, content: bytes = NMAP_XML) -> None:
        self.content = content
        self.downloaded: list[str] = []

    def ls_info(self, directory: str):
        return [{"path": f"{directory}/scan.xml", "size": len(self.content)}]

    def download_files(self, paths: list[str]):
        self.downloaded.extend(paths)
        return [SimpleNamespace(content=self.content, error=None)]


def _request(command: str, *, engagement: str = "acme") -> SimpleNamespace:
    return SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        tool_call={"id": "scan-1", "args": {"command": command}},
        state={"engagement_name": engagement, "workspace_path": "/workspace"},
    )


def _result() -> ToolMessage:
    return ToolMessage(content="scan finished\n[Exit code: 0]", name="bash", tool_call_id="scan-1")


def test_autoingest_slot_only_on_network_roles():
    from raptix.agents.middleware_slots import DEFAULT_SLOT_FACTORIES

    assert MiddlewareSlot.KG_AUTOINGEST in DEFAULT_SLOT_FACTORIES
    assert {
        role for role, slots in SLOTS_PER_ROLE.items() if MiddlewareSlot.KG_AUTOINGEST in slots
    } == {
        "recon",
        "exploit",
        "surface_exploit",
        "postexploit",
        "ad_operator",
        "cloud_hunter",
    }


def test_factory_default_off_does_not_open_kg(monkeypatch):
    from raptix.agents.middleware_slots import _make_kg_autoingest

    monkeypatch.delenv("DECEPTICON_KG_AUTOINGEST")
    assert _make_kg_autoingest(sandbox=_Sandbox(), role="recon") is None


def test_factory_flag_on_builds_hook(monkeypatch):
    from raptix.agents.middleware_slots import _make_kg_autoingest
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware
    from raptix.middleware.kg_internal.store import KGStore

    store = _Store()
    monkeypatch.setattr(KGStore, "from_env", lambda: store)
    assert isinstance(_make_kg_autoingest(sandbox=_Sandbox(), role="recon"), KGAutoIngestMiddleware)


async def test_nmap_output_is_ingested_after_tool_without_changing_result():
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    store, sandbox, result = _Store(), _Sandbox(), _result()
    hook = KGAutoIngestMiddleware(store=store, sandbox=sandbox, role="recon")

    async def handler(_request):
        assert store.writes == []
        return result

    returned = await hook.awrap_tool_call(
        _request("nmap -oX /workspace/scan.xml 10.0.0.1"), handler
    )
    assert returned is result
    assert sandbox.downloaded == ["/workspace/scan.xml"]
    assert store.writes[0]["engagement"] == "acme"
    assert {node["kind"] for node in store.writes[0]["observations"]} >= {"Host", "Service"}


async def test_ingest_failure_keeps_original_result():
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    class BrokenStore(_Store):
        def record_observations(self, observations, **scope):
            raise RuntimeError("neo4j down")

    result = _result()
    hook = KGAutoIngestMiddleware(store=BrokenStore(), sandbox=_Sandbox(), role="recon")

    async def handler(_request):
        return result

    returned = await hook.awrap_tool_call(
        _request("nmap -oX /workspace/scan.xml 10.0.0.1"), handler
    )
    assert returned is result
    assert returned.content == "scan finished\n[Exit code: 0]"


async def test_disabled_and_outside_workspace_do_not_fetch(monkeypatch):
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    sandbox, store, result = _Sandbox(), _Store(), _result()
    hook = KGAutoIngestMiddleware(store=store, sandbox=sandbox, role="recon")

    async def handler(_request):
        return result

    monkeypatch.setenv("DECEPTICON_KG_AUTOINGEST", "0")
    assert await hook.awrap_tool_call(_request("nmap -oX /workspace/scan.xml x"), handler) is result
    monkeypatch.setenv("DECEPTICON_KG_AUTOINGEST", "1")
    assert await hook.awrap_tool_call(_request("nmap -oX /etc/passwd x"), handler) is result
    assert sandbox.downloaded == []
    assert store.writes == []


async def test_oversized_scan_is_not_downloaded():
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    sandbox, store, result = _Sandbox(content=b"X" * 256_001), _Store(), _result()
    hook = KGAutoIngestMiddleware(store=store, sandbox=sandbox, role="recon")

    async def handler(_request):
        return result

    assert await hook.awrap_tool_call(_request("nmap -oX /workspace/scan.xml x"), handler) is result
    assert sandbox.downloaded == []
    assert store.writes == []


async def test_busy_ingesters_do_not_hold_up_the_tool():
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    sandbox, store, result = _Sandbox(), _Store(), _result()
    hook = KGAutoIngestMiddleware(store=store, sandbox=sandbox, role="recon")
    assert hook._slots.acquire(blocking=False)
    assert hook._slots.acquire(blocking=False)

    async def handler(_request):
        return result

    try:
        assert (
            await hook.awrap_tool_call(_request("nmap -oX /workspace/scan.xml x"), handler)
            is result
        )
        assert sandbox.downloaded == []
        assert store.writes == []
    finally:
        hook._slots.release()
        hook._slots.release()


async def test_failed_scan_does_not_ingest_stale_output_file():
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    sandbox, store = _Sandbox(), _Store()
    result = ToolMessage(content="nmap: failed\n[Exit code: 1]", tool_call_id="scan-1")
    hook = KGAutoIngestMiddleware(store=store, sandbox=sandbox, role="recon")

    async def handler(_request):
        return result

    assert await hook.awrap_tool_call(_request("nmap -oX /workspace/scan.xml x"), handler) is result
    assert sandbox.downloaded == []
    assert store.writes == []


async def test_recorded_tool_reply_can_be_replayed_into_autoingest(tmp_path: Path):
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    record_path = tmp_path / "scan.jsonl"
    request, result = _request("nmap -oX /workspace/scan.xml 10.0.0.1"), _result()
    recorder = RecordingMiddleware(path=record_path)
    recorder.wrap_tool_call(request, lambda _request: result)
    assert recorder._sink is not None
    recorder._sink.close()
    replay = ReplayMiddleware(path=record_path, strict=True)
    store = _Store()
    hook = KGAutoIngestMiddleware(store=store, sandbox=_Sandbox(), role="recon")

    async def live_handler(_request):
        raise AssertionError("live sandbox call during replay")

    async def replay_handler(request):
        return await replay.awrap_tool_call(request, live_handler)

    returned = await hook.awrap_tool_call(request, replay_handler)
    assert returned.content == result.content
    assert returned.tool_call_id == result.tool_call_id
    assert store.writes[0]["engagement"] == "acme"
    assert any(node["kind"] == "Host" for node in store.writes[0]["observations"])


async def test_replay_recon_turn_preserves_model_decisions_and_autoingests(tmp_path: Path):
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    record_path = tmp_path / "recon.jsonl"
    request = _request("nmap -oX /workspace/scan.xml 10.0.0.1")
    model = SimpleNamespace(name="recon-replay")
    first = SimpleNamespace(
        model=model,
        system_message=None,
        messages=[HumanMessage(content="scan the target")],
        tools=[request.tool],
    )
    decision = AIMessage(
        content="",
        tool_calls=[{"name": "bash", "args": request.tool_call["args"], "id": "scan-1"}],
    )
    recorder = RecordingMiddleware(path=record_path)
    recorder.wrap_model_call(first, lambda _request: decision)
    reply = _result()
    recorder.wrap_tool_call(request, lambda _request: reply)
    second = SimpleNamespace(
        model=model,
        system_message=None,
        messages=[*first.messages, decision, reply],
        tools=[request.tool],
    )
    final = AIMessage(content="recon complete")
    recorder.wrap_model_call(second, lambda _request: final)
    assert recorder._sink is not None
    recorder._sink.close()

    replay = ReplayMiddleware(path=record_path, strict=True)

    def live_model(_request):
        raise AssertionError("live model was called")

    first_reply = replay.wrap_model_call(first, live_model)
    assert first_reply.tool_calls == decision.tool_calls
    store = _Store()
    hook = KGAutoIngestMiddleware(store=store, sandbox=_Sandbox(), role="recon")

    async def live_tool(_request):
        raise AssertionError("live scanner was called")

    async def replay_tool(req):
        return await replay.awrap_tool_call(req, live_tool)

    tool_reply = await hook.awrap_tool_call(request, replay_tool)
    assert tool_reply.content == reply.content
    second.messages = [*first.messages, first_reply, tool_reply]
    assert replay.wrap_model_call(second, live_model).content == final.content
    assert store.writes[0]["engagement"] == "acme"
