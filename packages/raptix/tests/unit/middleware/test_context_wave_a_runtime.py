"""Wave A regressions across compiled graphs, compaction and dispatch boundaries."""

from types import SimpleNamespace
from typing import Annotated, NotRequired, get_type_hints

import httpx
import pytest
from deepagents.backends import CompositeBackend
from deepagents.backends.filesystem import FilesystemBackend
from deepagents.backends.state import StateBackend
from deepagents.middleware.summarization import SummarizationMiddleware
from langchain.agents import create_agent
from langchain.agents.middleware.types import (
    AgentMiddleware,
    AgentState,
    ExtendedModelResponse,
    ModelRequest,
    ModelResponse,
    PrivateStateAttr,
)
from langchain_core.exceptions import ContextOverflowError
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai.chat_models.base import OpenAIContextOverflowError
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
from typing_extensions import TypedDict

from raptix.core.dispatch_context import DispatchContext, active_dispatch
from raptix.core.subagent_streaming import StreamingRunnable
from raptix.intelligence.agents.middleware_slots import _make_summarization
from raptix.intelligence.llm.factory import _reraise_with_actionable_message
from raptix.middleware.dispatch import DispatchMiddleware
from raptix.middleware.filesystem import FilesystemMiddleware
from raptix.middleware.skillogy import _make_load_skill_tool


@pytest.fixture(autouse=True)
def clear_operator_settings(monkeypatch):
    for name in (
        "RAPTIX_LLM__MAX_INPUT_TOKENS",
        "RAPTIX_SUMMARIZATION_TRIGGER_TOKENS",
        "RAPTIX_SUMMARIZATION_KEEP_MESSAGES",
        "RAPTIX_RUNTIME__RECORD_PATH",
    ):
        monkeypatch.delenv(name, raising=False)


def _model(profile=None):
    return GenericFakeChatModel(messages=iter([AIMessage(content="summary")]), profile=profile)


def _slot(backend=None, llm=None):
    return _make_summarization(
        backend=backend if backend is not None else StateBackend(),
        llm=llm if llm is not None else _model(),
    )


class FullState(TypedDict, total=False):
    messages: list
    internal_notes: str


class PublicState(TypedDict):
    messages: list


@pytest.fixture
def streaming_channels(monkeypatch):
    monkeypatch.setattr(
        StreamingRunnable, "_get_channels", lambda self: (None, False, lambda event: None)
    )


def test_real_compiled_graph_output_projection(streaming_channels):
    graph = StateGraph(FullState, output_schema=PublicState)
    graph.add_node(
        "finish",
        lambda state: {
            "messages": [AIMessage(content="done")],
            "internal_notes": "child-only",
        },
    )
    graph.add_edge(START, "finish")
    graph.add_edge("finish", END)
    returned = StreamingRunnable(graph.compile(), "worker").invoke(
        {"messages": [HumanMessage(content="task")]}
    )
    assert "internal_notes" not in returned


def test_parent_private_event_not_supplied_to_fresh_child():
    event = {"cutoff_index": 100, "summary_message": HumanMessage(content="parent")}
    runtime = SimpleNamespace(state={"_summarization_event": event, "context_epoch": 5})
    child = DispatchMiddleware._child_runtime(runtime, DispatchContext("d", "o", 1))
    assert "_summarization_event" not in child.state
    assert "context_epoch" not in child.state
    assert runtime.state["_summarization_event"] is event


def test_epoch_is_a_declared_state_channel():
    assert "context_epoch" in get_type_hints(_slot().state_schema, include_extras=True)


class PrivateNoteState(AgentState):
    _worker_notes: NotRequired[Annotated[str, PrivateStateAttr]]


class PrivateNoteMiddleware(AgentMiddleware):
    state_schema = PrivateNoteState

    def before_model(self, state, runtime):
        return {"_worker_notes": "worker-private"}


def test_real_agent_private_notes_not_forwarded(streaming_channels):
    compiled = create_agent(_model(), middleware=[PrivateNoteMiddleware()])
    assert "_worker_notes" not in compiled.get_output_schema().model_fields
    returned = StreamingRunnable(compiled, "worker").invoke(
        {"messages": [HumanMessage(content="task")]}
    )
    assert "_worker_notes" not in returned


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_partial_failure_keeps_public_projection(streaming_channels, asynchronous):
    graph = StateGraph(FullState, output_schema=PublicState)
    graph.add_node("partial", lambda state: {"internal_notes": "partial-private"})

    def fail(state):
        raise RuntimeError("worker failed after yielding state")

    graph.add_node("fail", fail)
    graph.add_edge(START, "partial")
    graph.add_edge("partial", "fail")
    graph.add_edge("fail", END)
    wrapper = StreamingRunnable(graph.compile(), "worker")
    inputs = {"messages": [HumanMessage(content="task")]}
    returned = await wrapper.ainvoke(inputs) if asynchronous else wrapper.invoke(inputs)
    assert "internal_notes" not in returned
    assert "failed" in returned["messages"][-1].content
    assert returned["subagent_transcripts"][-1]["error"]


@pytest.mark.parametrize("pointer", [None, "/workspace/conversation_history/thread.md"])
def test_real_wrapped_error_summary_is_rejected(pointer):
    proxy = _slot()
    summary = proxy._inner._build_new_messages_with_path(
        "Error generating summary: provider failed", pointer
    )[0]
    response = ExtendedModelResponse(
        ModelResponse(result=[AIMessage(content="done")]),
        Command(
            update={
                "_summarization_event": {
                    "cutoff_index": 2,
                    "summary_message": summary,
                    "file_path": pointer,
                }
            }
        ),
    )
    checked = proxy._finalize(response, SimpleNamespace(state={}, messages=[]))
    assert checked.command is not None
    assert "_summarization_event" not in checked.command.update


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_failed_summary_never_reaches_downstream_model(tmp_path, asynchronous):
    llm = GenericFakeChatModel(messages=iter([]))  # provider fails during summary
    proxy = _slot(
        CompositeBackend(
            default=FilesystemBackend(root_dir=tmp_path, virtual_mode=True),
            routes={},
        ),
        llm,
    )
    proxy._inner = SummarizationMiddleware(
        model=llm,
        backend=proxy._inner._backend,
        trigger=("messages", 2),
        keep=("messages", 1),
        trim_tokens_to_summarize=None,
    )
    messages = [HumanMessage(content="original work", id="h"), AIMessage(content="keep", id="a")]
    request = ModelRequest(
        model=llm,
        messages=messages,
        state={"messages": messages, "workspace_path": "/workspace/lab"},
        runtime=SimpleNamespace(context=None, stream_writer=None, store=None, config={}),
    )
    downstream = []

    def handler(req):
        downstream.append(req)
        return ModelResponse(result=[AIMessage(content="done")])

    async def ahandler(req):
        return handler(req)

    if asynchronous:
        await proxy.awrap_model_call(request, ahandler)
    else:
        proxy.wrap_model_call(request, handler)
    assert len(downstream) == 1
    assert downstream[0].messages == messages


@pytest.mark.parametrize("provider_subtype", [False, True])
def test_overflow_redacts_message_without_losing_type(provider_subtype):
    secret = "sk-review-test-token-123456789"
    message = f"context exceeded Bearer {secret}"
    if provider_subtype:
        response = httpx.Response(400, request=httpx.Request("POST", "http://proxy.test"))
        original = OpenAIContextOverflowError(message, response=response, body=None)
    else:
        original = ContextOverflowError(message)
    try:
        try:
            raise original
        except Exception as exc:
            _reraise_with_actionable_message(exc, "test-model")
            raise
    except ContextOverflowError as exc:
        assert type(exc) is type(original)
        assert secret not in str(exc)


def test_wrapped_overflow_reaches_compaction_as_overflow():
    original = ContextOverflowError("context exceeded")
    outer = RuntimeError("provider wrapper")
    outer.__cause__ = original
    with pytest.raises(ContextOverflowError):
        try:
            raise outer
        except Exception as exc:
            _reraise_with_actionable_message(exc, "test-model")
            raise


def test_operator_override_changes_actual_trigger(monkeypatch):
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "90000")
    assert _slot()._inner._should_summarize([HumanMessage(content="work")], 100000)


def test_rebind_changes_actual_fraction_trigger():
    proxy = _slot()
    rebound = proxy._scoped_inner(SimpleNamespace(model=_model({"max_input_tokens": 400000})))
    assert not rebound._should_summarize([HumanMessage(content="work")], 180000)
    assert proxy._inner._should_summarize([HumanMessage(content="work")], 180000)


def test_capacity_setting_survives_normal_request_rebind(monkeypatch):
    monkeypatch.setenv("RAPTIX_LLM__MAX_INPUT_TOKENS", "200000")
    llm = _model()
    proxy = _slot(llm=llm)
    rebound = proxy._scoped_inner(SimpleNamespace(model=llm))
    assert rebound._get_profile_limits() == 200000
    assert not rebound._should_summarize([HumanMessage(content="work")], 160000)
    assert llm.profile is None


def test_trigger_pin_equal_to_old_default_survives_model_rebind(monkeypatch):
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "170000")
    proxy = _slot()
    rebound = proxy._scoped_inner(SimpleNamespace(model=_model({"max_input_tokens": 400000})))
    assert rebound._should_summarize([HumanMessage(content="work")], 180000)
    assert rebound._lc_helper.keep == ("fraction", 0.10)


def test_real_offload_pointer_readable_via_worker_backend(tmp_path):
    backend = CompositeBackend(
        default=FilesystemBackend(root_dir=tmp_path, virtual_mode=True), routes={}
    )
    proxy = _slot(backend)
    runtime = SimpleNamespace(state={"workspace_path": "/workspace/lab"}, config={})
    history = proxy._inner._offload_to_backend(
        proxy._inner._backend(runtime), [HumanMessage(content="evidence")]
    )
    assert history is not None
    read_back = FilesystemMiddleware(backend=backend)._get_backend(runtime).read(history)
    assert read_back.error is None
    assert read_back.file_data is not None
    assert "evidence" in read_back.file_data["content"]


@pytest.mark.parametrize("workspace", [None, "/invalid"])
def test_missing_or_invalid_workspace_offload_is_nonfatal(tmp_path, workspace):
    backend = CompositeBackend(
        default=FilesystemBackend(root_dir=tmp_path, virtual_mode=True), routes={}
    )
    proxy = _slot(backend)
    resolved = proxy._inner._backend(
        SimpleNamespace(state={"workspace_path": workspace}, config={})
    )
    assert proxy._inner._offload_to_backend(resolved, [HumanMessage(content="evidence")]) is None


class SkillBackend:
    def load_skill(self, path):
        return {"name": "x", "path": path, "body": "SKILL BODY"}


class SkillRun(TypedDict, total=False):
    dispatch_id: str
    attempt: int
    reply: str
    repeat: str


@pytest.mark.parametrize("second_dispatch,second_attempt", [("objective-2", 1), ("objective-1", 2)])
def test_fresh_dispatch_generation_same_parent_thread_receives_body(
    monkeypatch, second_dispatch, second_attempt
):
    monkeypatch.setenv("RAPTIX_SKILL_DEDUPE_SCOPE", "thread")
    tool = _make_load_skill_tool(SkillBackend())

    def child(state):
        token = active_dispatch.set(DispatchContext(state["dispatch_id"], None, state["attempt"]))
        try:
            return {
                "reply": tool.invoke({"name_or_path": "/skills/x/SKILL.md"}),
                "repeat": tool.invoke({"name_or_path": "/skills/x/SKILL.md"}),
            }
        finally:
            active_dispatch.reset(token)

    graph = StateGraph(SkillRun)
    graph.add_node("load", child)
    graph.add_edge(START, "load")
    graph.add_edge("load", END)
    compiled = graph.compile()
    config = {"configurable": {"thread_id": "parent-thread"}}
    first = compiled.invoke({"dispatch_id": "objective-1", "attempt": 1}, config)
    second = compiled.invoke({"dispatch_id": second_dispatch, "attempt": second_attempt}, config)
    assert "SKILL BODY" in first["reply"]
    assert "SKILL BODY" in second["reply"]
    assert "already_loaded" in second["repeat"]


def test_epoch_survives_event_loss_and_worker_identity_is_unique():
    event = {
        "cutoff_index": 1,
        "summary_message": HumanMessage(content="summary"),
        "file_path": None,
    }
    request = SimpleNamespace(
        state={"context_epoch": 8, "messages": [HumanMessage(content="work", id="covered")]},
        runtime=SimpleNamespace(config={"configurable": {"thread_id": "thread"}}),
    )
    response = ExtendedModelResponse(
        ModelResponse(result=[AIMessage(content="done")]),
        Command(update={"_summarization_event": event}),
    )
    first = _slot()._finalize(response, request)
    second = _slot()._finalize(response, request)
    assert first.command is not None and second.command is not None
    assert first.command.update["context_epoch"] == 9
    assert first.command.update["_summarization_event"]["covered_message_ids"] == ["covered"]
    assert (
        first.command.update["_summarization_event"]["worker_instance_id"]
        != second.command.update["_summarization_event"]["worker_instance_id"]
    )


class WorkspaceState(AgentState):
    workspace_path: NotRequired[str]


def test_real_graph_commits_compaction_epoch_and_identity(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_TRIGGER_TOKENS", "1")
    monkeypatch.setenv("RAPTIX_SUMMARIZATION_KEEP_MESSAGES", "1")
    llm = GenericFakeChatModel(
        messages=iter([AIMessage(content="summary"), AIMessage(content="done")])
    )
    backend = CompositeBackend(
        default=FilesystemBackend(root_dir=tmp_path, virtual_mode=True), routes={}
    )
    graph = create_agent(
        llm,
        middleware=[_slot(backend, llm)],
        state_schema=WorkspaceState,
        checkpointer=InMemorySaver(),
    )
    config = {"configurable": {"thread_id": "persisted"}}
    graph.invoke(
        {
            "messages": [
                HumanMessage(content="work"),
                AIMessage(content="earlier result"),
                HumanMessage(content="continue"),
            ],
            "workspace_path": "/workspace/lab",
        },
        config,
    )
    state = graph.get_state(config).values
    assert state["context_epoch"] == 1
    assert state["_summarization_event"]["context_epoch"] == 1
    assert state["_summarization_event"]["thread_id"] == "persisted"
    assert state["_summarization_event"]["file_path"].startswith("/workspace/conversation_history/")
    assert "context_epoch" not in graph.get_output_schema().model_fields


@pytest.mark.parametrize("asynchronous", [False, True])
async def test_actual_task_tool_preserves_parent_context(streaming_channels, asynchronous):
    graph = StateGraph(FullState, output_schema=PublicState)
    graph.add_node(
        "finish",
        lambda state: {
            "messages": [AIMessage(content="done")],
            "internal_notes": "child-private",
        },
    )
    graph.add_edge(START, "finish")
    graph.add_edge("finish", END)
    middleware = DispatchMiddleware(
        backend=object(),
        subagents=[
            {
                "name": "worker",
                "description": "test worker",
                "runnable": StreamingRunnable(graph.compile(), "worker"),
            }
        ],
    )
    messages = [HumanMessage(content="parent history")]
    event = {"cutoff_index": 0, "summary_message": HumanMessage(content="parent summary")}
    runtime = SimpleNamespace(
        state={"messages": messages, "_summarization_event": event, "context_epoch": 8},
        tool_call_id="task-1",
        config={"configurable": {"thread_id": "parent"}},
    )
    kwargs = {"description": "task", "subagent_type": "worker", "runtime": runtime}
    task = middleware.tools[0]
    response = await task.coroutine(**kwargs) if asynchronous else task.func(**kwargs)
    assert "_summarization_event" not in response.update
    assert "context_epoch" not in response.update
    assert "internal_notes" not in response.update
    assert response.update["messages"][0].content == "done"
    assert runtime.state["messages"] == messages
    assert runtime.state["_summarization_event"] is event
