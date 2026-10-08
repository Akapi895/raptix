"""Owned overlay assembly with zero/positive budgets and immutable guardrails."""

import asyncio
import json
import re
from types import SimpleNamespace

import pytest
from deepagents.backends.filesystem import FilesystemBackend
from langchain.agents import create_agent
from langchain.agents.middleware.types import ModelRequest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field

from benchmarks.context_eval.overlay_probe import SkillFixture, fixture_request
from raptix.intelligence.agents.build import build_middleware
from raptix.intelligence.context.blocks import emit_block, owned_scope
from raptix.intelligence.context.manifest import build_manifest
from raptix.middleware.context_manifest import ContextManifestMiddleware
from raptix.middleware.kg import KGMiddleware
from raptix.middleware.skillogy import _POLICY_PROMPT, SkillogyMiddleware
from raptix.orchestration.mission.opplan import OPPLANMiddleware
from raptix_core.contracts.slots import MiddlewareSlot as Slot


@pytest.fixture(autouse=True)
def flags(monkeypatch):
    monkeypatch.setenv("RAPTIX_CONTEXT_ASSEMBLY", "1")
    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", "0")
    monkeypatch.delenv("RAPTIX_CONTEXT_MASK", raising=False)
    monkeypatch.delenv("RAPTIX_CONTEXT_MANIFEST", raising=False)


@pytest.fixture
def backend(tmp_path):
    return FilesystemBackend(root_dir=tmp_path, virtual_mode=True)


def inject(request):
    request = SkillogyMiddleware(agent_phase="recon", backend=SkillFixture())._inject(request)
    request = OPPLANMiddleware()._inject_opplan_context(request)
    return KGMiddleware(store=SimpleNamespace(), enabled_tools=[])._inject_kg_context(request)


def test_unlimited_assembly_preserves_all_blocks_and_metadata(backend):
    with owned_scope():
        request = inject(fixture_request(120))
        processed = ContextManifestMiddleware(backend=backend)._process(request)
        assert processed is request
        manifest = build_manifest(processed)
        owners = {block["owner"] for block in manifest["blocks"]}
        assert {"skillogy", "opplan", "kg"} <= owners
        assert any(block["source_revision"] == "fixture:1" for block in manifest["blocks"])
        assert all("owner" not in block for block in processed.system_message.content_blocks)
    # Nothing is offloaded just for C3c with an unlimited budget.
    assert backend.ls("/workspace/.scratch").error is not None


def test_positive_budget_retains_active_acceptance_and_readable_full_overlays(backend, monkeypatch):
    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", "7000")
    with owned_scope():
        request = fixture_request(120)
        request.state["objectives"][0]["blocked_by"] = ["OBJ-002"]
        request = request.override(
            system_message=SystemMessage(
                content=[
                    {
                        "type": "text",
                        "text": "<ROE>only authorized scope</ROE>",
                        "cache_control": {"type": "ephemeral"},
                    },
                ]
            )
        )
        request = inject(request)
        processed = ContextManifestMiddleware(backend=backend)._process(request)
        assert build_manifest(processed)["total_token_estimate"] <= 7000
        text = processed.system_message.text
        assert "OBJ-001" in text and "OBJ-002" in text and "retain evidence" in text
        assert _POLICY_PROMPT in text
        assert (
            processed.system_message.content_blocks[0] == request.system_message.content_blocks[0]
        )
        refs = re.findall(r"/workspace/\.scratch/context-[a-f0-9]+\.txt", text)
        assert refs
        from raptix.middleware.filesystem import EngagementFilesystemBackend

        scoped = EngagementFilesystemBackend(backend, "/workspace")
        full_texts = {block["text"] for block in request.system_message.content_blocks}
        for ref in refs:
            saved = scoped.read(ref, limit=1_000_001).file_data
            assert saved is not None and saved["content"] in full_texts
        assert request.messages is processed.messages


def test_impossible_budget_preserves_required_blocks_instead_of_blocking(backend, monkeypatch):
    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", "1")
    request = ModelRequest(
        model=GenericFakeChatModel(messages=iter([])),
        tools=[],
        messages=[HumanMessage("important current task")],
        state={},
        runtime=None,
        system_message=SystemMessage(content="mandatory guardrail"),
    )
    processed = ContextManifestMiddleware(backend=backend)._process(request)
    assert processed.system_message.content == "mandatory guardrail"
    assert processed.messages is request.messages


@pytest.mark.parametrize("invalid", ["-1", "invalid", "1.5"])
def test_bad_budget_names_variable(invalid, monkeypatch):
    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", invalid)
    with pytest.raises(RuntimeError, match="RAPTIX_CONTEXT_BUDGET_TOKENS"):
        ContextManifestMiddleware()


def test_duplicate_owned_block_is_removed_without_changing_unknown_blocks(backend):
    with owned_scope():
        block = emit_block("opplan", "progress", {"type": "text", "text": "progress"})
        request = ModelRequest(
            model=GenericFakeChatModel(messages=iter([])),
            tools=[],
            messages=[],
            state={},
            runtime=None,
            system_message=SystemMessage(
                content=[{"type": "text", "text": "required"}, block, block]
            ),
        )
        processed = ContextManifestMiddleware(backend=backend)._process(request)
        assert [block["text"] for block in processed.system_message.content_blocks] == [
            "required",
            "progress",
        ]


async def test_parallel_requests_do_not_share_block_provenance():
    async def one(revision):
        with owned_scope():
            block = emit_block(
                "kg", "summary", {"type": "text", "text": "same content"}, source_revision=revision
            )
            await asyncio.sleep(0)
            request = SimpleNamespace(
                system_message=SystemMessage(content=[block]), messages=[], state={}
            )
            return build_manifest(request)["blocks"][0]["source_revision"]

    assert await asyncio.gather(one("first"), one("second")) == ["first", "second"]


class CaptureModel(GenericFakeChatModel):
    seen: list[list[dict]] = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        if messages and isinstance(messages[0], SystemMessage):
            self.seen.append(messages[0].content_blocks)
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


class StoreFixture:
    def revision(self, *, engagement):
        return "fixture:1"


@pytest.mark.parametrize("budget", [0, 6000])
@pytest.mark.parametrize("asynchronous", [False, True])
async def test_real_assembled_agent_preserves_safety_blocks_and_checkpoint(
    backend, monkeypatch, budget, asynchronous
):
    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", str(budget))
    model = CaptureModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "load_opplan",
                            "args": {"workspace_path": "/workspace/lab"},
                            "id": "load",
                        }
                    ],
                ),
                AIMessage("done"),
            ]
        )
    )
    state = fixture_request(120).state
    state["workspace_path"] = "/workspace/lab"
    from raptix.execution.tools.opplan import _persist_opplan_to_backend

    _persist_opplan_to_backend(
        backend, "/workspace/lab", state["objectives"], "fixture", "synthetic"
    )
    selected = frozenset(
        {
            Slot.ENGAGEMENT_CONTEXT,
            Slot.ROE_GUARDRAIL,
            Slot.UNTRUSTED_OUTPUT,
            Slot.PROMPT_INJECTION_SHIELD,
            Slot.OPPLAN,
            Slot.KG,
            Slot.CONTEXT_MANIFEST,
        }
    )
    middleware = build_middleware(
        role="raptix",
        backend=backend,
        llm=model,
        slots=selected,
        overrides={Slot.KG: lambda **kwargs: KGMiddleware(store=StoreFixture(), enabled_tools=[])},
    )
    agent = create_agent(model, middleware=middleware, checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": f"assembled-{budget}-{asynchronous}"}}
    agent.update_state(config, state)
    if asynchronous:
        await agent.ainvoke({"messages": [HumanMessage("retain criteria and evidence")]}, config)
    else:
        agent.invoke({"messages": [HumanMessage("retain criteria and evidence")]}, config)
    assert model.seen
    payload = json.dumps(model.seen[-1])
    assert "retain evidence" in payload and "OBJ-001" in payload, agent.get_state(
        config
    ).values.get("objectives", [])[:1]
    assert "raptix_context" not in payload and '"owner"' not in payload
    checkpoint = agent.get_state(config).values
    assert len(checkpoint["objectives"]) == 120
    assert checkpoint["kg_summary"] == state["kg_summary"]


def test_actual_guardrail_overlays_remain_byte_identical_under_small_budget(backend, monkeypatch):
    from raptix.middleware.prompt_injection_shield import PromptInjectionShieldMiddleware
    from raptix.middleware.untrusted_output import UntrustedOutputMiddleware
    from raptix.orchestration.mission.engagement import EngagementContextMiddleware

    monkeypatch.setenv("RAPTIX_CONTEXT_BUDGET_TOKENS", "1")
    with owned_scope():
        request = fixture_request(120)
        request.state["engagement_name"] = "fixture"
        request = EngagementContextMiddleware()._inject(request)
        request = UntrustedOutputMiddleware()._inject_policy(request)
        request = PromptInjectionShieldMiddleware()._inject_policy(request)
        protected = list(request.system_message.content_blocks)
        request = inject(request)
        processed = ContextManifestMiddleware(backend=backend)._process(request)
        assert processed.system_message.content_blocks[: len(protected)] == protected


async def test_default_off_record_replays_with_unlimited_owned_assembly(
    backend, monkeypatch, tmp_path
):
    from langchain.agents.middleware.types import ModelResponse

    from raptix.runtime.recording import RecordingMiddleware, ReplayMiddleware

    monkeypatch.setenv("RAPTIX_CONTEXT_ASSEMBLY", "0")
    original = inject(fixture_request(2))
    reply = ModelResponse(result=[AIMessage("recorded decision")])
    recorder = RecordingMiddleware(path=tmp_path / "context-replay.jsonl")
    recorder.wrap_model_call(original, lambda request: reply)
    assert recorder._sink is not None
    recorder._sink.close()
    replay = ReplayMiddleware(path=tmp_path / "context-replay.jsonl", strict=True)
    monkeypatch.setenv("RAPTIX_CONTEXT_ASSEMBLY", "1")
    with owned_scope():
        candidate = ContextManifestMiddleware(backend=backend)._process(inject(fixture_request(2)))
        assert candidate.system_message.content == original.system_message.content

        async def live_model(request):
            raise AssertionError("offline replay must not call a provider")

        response = await replay.awrap_model_call(candidate, live_model)
        assert isinstance(response, AIMessage)
        assert response.content == "recorded decision"
