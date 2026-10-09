"""Acceptance counterexamples from the context-plan completion review."""

import json

import pytest
from deepagents.backends.filesystem import FilesystemBackend
from deepagents.backends.protocol import WriteResult
from langchain.agents import create_agent
from langchain.agents.middleware.types import ExtendedModelResponse, ModelResponse
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command

from raptix.intelligence.context.summary_contract import validate_structured_summary
from raptix.middleware.filesystem import EngagementFilesystemBackend
from raptix.orchestration.mission.handoff import claim_lease
from raptix.orchestration.mission.task_budget import TaskBudgetMiddleware, usage_delta
from raptix.orchestration.mission.task_state import (
    TaskState,
    advance_task_state,
    fold_task_budget,
    read_task_state,
    write_task_state,
)
from raptix.runtime.recording import export_sanitized, sanitize_entry


def test_structured_summary_rejects_nontext_failure_reason():
    body = {
        "completed_work": [],
        "evidence": [],
        "failed_attempts": [{"action_hash": "a" * 64, "reason": {}, "retry_condition": []}],
        "unresolved": [],
        "hypotheses": [],
    }
    accepted, errors = validate_structured_summary(
        "```json\n" + json.dumps(body) + "\n```", action_hashes=["a" * 64]
    )
    assert not accepted


def test_compiled_agent_accounts_usage_in_request_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPTIX_TASK_BUDGET", "1")
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    reply = AIMessage(
        content="done", usage_metadata={"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}
    )
    agent = create_agent(
        GenericFakeChatModel(messages=iter([reply])),
        middleware=[TaskBudgetMiddleware(backend=backend)],
    )
    agent.invoke(
        {"messages": [HumanMessage(content="offline")], "active_objective_id": "A"},
        {"configurable": {"workspace_path": "/workspace/lab"}},
    )
    saved = read_task_state(EngagementFilesystemBackend(backend, "/workspace/lab"), "A").state
    assert saved is not None
    assert saved.budget.input_tokens == 10


def test_extended_model_response_preserves_usage():
    reply = AIMessage(
        content="done", usage_metadata={"input_tokens": 10, "output_tokens": 2, "total_tokens": 12}
    )
    extended = ExtendedModelResponse(ModelResponse(result=[reply]), Command(update={}))
    assert usage_delta(extended) == (1, 10, 2)


def test_stale_work_snapshot_cannot_reset_accounting(tmp_path):
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    write_task_state(backend, TaskState(objective_id="A", state_revision=4))
    snapshot = read_task_state(backend, "A").state
    fold_task_budget(backend, "A", input_tokens=10)
    stale = advance_task_state({"id": "A"}, prior=snapshot)
    write_task_state(backend, stale)
    saved = read_task_state(backend, "A").state
    assert saved is not None and saved.budget.input_tokens == 10


def test_failed_storage_never_grants_a_lease(tmp_path):
    class FailedBackend(FilesystemBackend):
        def write(self, file_path, content):
            return WriteResult(error="synthetic storage failure")

    backend = FailedBackend(root_dir=tmp_path, virtual_mode=True)
    assert claim_lease(backend, "A", token="one") is not None


def test_sanitizer_redacts_structured_and_embedded_json_credentials():
    secret = "SyntheticCredentialForAuditOnly"
    entry = {"password": secret, "content": json.dumps({"api_key": secret})}
    assert secret not in json.dumps(sanitize_entry(entry))


def test_sanitized_export_refuses_source_destination_identity(tmp_path):
    path = tmp_path / "raw.jsonl"
    original = '{"kind":"model_call","req_hash":"fake"}\n'
    path.write_text(original, encoding="utf-8")
    with pytest.raises(ValueError):
        export_sanitized(path, path)
    assert path.read_text(encoding="utf-8") == original
