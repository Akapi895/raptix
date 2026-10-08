"""Cross-dispatch budget accounting folds usage without touching the workflow."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from deepagents.backends.protocol import EditResult, LsResult, ReadResult, WriteResult
from langchain.agents.middleware.types import ModelResponse
from langchain_core.messages import AIMessage, SystemMessage

from raptix.orchestration.mission.task_state import (
    TaskState,
    fold_task_budget,
    read_task_state,
)


class MemoryBackend:
    def __init__(self, *, broken: bool = False) -> None:
        self.files: dict[str, str] = {}
        self.broken = broken

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if self.broken:
            raise RuntimeError("backend down")
        if file_path not in self.files:
            return ReadResult(error=f"file_not_found: '{file_path}'")
        return ReadResult(
            file_data={
                "content": self.files[file_path][offset : offset + limit],
                "encoding": "utf-8",
            }
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        if self.broken:
            raise RuntimeError("backend down")
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old: str, new: str, replace_all: bool = False) -> EditResult:
        if self.broken:
            raise RuntimeError("backend down")
        self.files[file_path] = self.files[file_path].replace(old, new)
        return EditResult(path=file_path, occurrences=1)

    def ls_info(self, path: str) -> list:
        return []

    def ls(self, path: str) -> LsResult:
        return LsResult(entries=[])


def _model_request(objective: str = "A"):
    return SimpleNamespace(
        state={"workspace_path": "/workspace", "active_objective_id": objective},
        runtime=None,
        system_message=SystemMessage(content="base prompt"),
        messages=[],
        override=lambda **kwargs: SimpleNamespace(
            state={"workspace_path": "/workspace", "active_objective_id": objective},
            runtime=None,
            system_message=kwargs["system_message"],
            messages=[],
            override=None,
        ),
    )


def _response(input_tokens: int = 0, output_tokens: int = 0) -> ModelResponse:
    return ModelResponse(
        result=[
            AIMessage(
                content="ok",
                usage_metadata={
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                },
            )
        ],
        structured_response=None,
    )


def _scoped(backend: MemoryBackend):
    from raptix.middleware.filesystem import EngagementFilesystemBackend

    return EngagementFilesystemBackend(backend, "/workspace")


def test_slot_registered_and_default_off(monkeypatch) -> None:
    from raptix.intelligence.agents.middleware_slots import (
        DEFAULT_SLOT_FACTORIES,
        _make_task_budget,
    )
    from raptix_core.contracts.slots import SLOTS_PER_ROLE
    from raptix_core.contracts.slots import MiddlewareSlot as Slot

    assert Slot.TASK_BUDGET in DEFAULT_SLOT_FACTORIES
    assert Slot.TASK_BUDGET in SLOTS_PER_ROLE["recon"]
    monkeypatch.delenv("RAPTIX_TASK_BUDGET", raising=False)
    assert _make_task_budget(role="recon") is None
    monkeypatch.setenv("RAPTIX_TASK_BUDGET", "1")
    assert _make_task_budget(role="recon") is not None


def test_flag_off_does_not_record_usage(monkeypatch) -> None:
    from raptix.orchestration.mission.task_budget import TaskBudgetMiddleware

    monkeypatch.delenv("RAPTIX_TASK_BUDGET", raising=False)
    backend = MemoryBackend()
    middleware = TaskBudgetMiddleware(backend=backend)
    response = _response(input_tokens=11, output_tokens=7)
    assert middleware.wrap_model_call(_model_request(), lambda _r: response) is response
    assert backend.files == {}


def test_usage_folds_into_task_state_without_bumping_revision(monkeypatch) -> None:
    from raptix.orchestration.mission.task_budget import TaskBudgetMiddleware

    monkeypatch.setenv("RAPTIX_TASK_BUDGET", "1")
    backend = MemoryBackend()
    middleware = TaskBudgetMiddleware(backend=backend)
    request = _model_request()
    middleware.wrap_model_call(request, lambda _r: _response(input_tokens=100, output_tokens=20))
    middleware.wrap_model_call(request, lambda _r: _response(input_tokens=50, output_tokens=10))
    saved = read_task_state(_scoped(backend), "A").state
    assert saved is not None
    assert (saved.budget.model_calls, saved.budget.input_tokens, saved.budget.output_tokens) == (
        2,
        150,
        30,
    )
    assert saved.state_revision == 0


async def test_async_usage_folds_into_task_state(monkeypatch) -> None:
    from raptix.orchestration.mission.task_budget import TaskBudgetMiddleware

    monkeypatch.setenv("RAPTIX_TASK_BUDGET", "1")
    backend = MemoryBackend()
    middleware = TaskBudgetMiddleware(backend=backend)
    response = _response(input_tokens=42, output_tokens=8)

    async def handler(_request):
        return response

    assert await middleware.awrap_model_call(_model_request(), handler) is response
    saved = read_task_state(_scoped(backend), "A").state
    assert saved is not None
    assert saved.budget.input_tokens == 42
    assert saved.budget.output_tokens == 8


def test_soft_token_limit_reminds_once_per_objective(monkeypatch) -> None:
    from raptix.orchestration.mission.task_budget import TaskBudgetMiddleware

    monkeypatch.setenv("RAPTIX_TASK_BUDGET", "1")
    backend = MemoryBackend()
    middleware = TaskBudgetMiddleware(backend=backend, token_limit=5)
    seen: list[str] = []

    def handler(request):
        seen.append(str(request.system_message.content))
        return _response(input_tokens=3, output_tokens=2)

    request = _model_request()
    middleware.wrap_model_call(request, handler)
    middleware.wrap_model_call(_model_request(), handler)
    middleware.wrap_model_call(_model_request(), handler)
    assert "base prompt" in seen[0]
    assert "soft limit" in seen[1]
    assert "soft limit" in seen[2]
    saved = read_task_state(_scoped(backend), "A").state
    assert saved is not None
    markers = [
        entry for entry in saved.decision_record if entry.action == "budget_exhausted:tokens"
    ]
    assert len(markers) == 1


def test_soft_call_limit_records_call_marker(monkeypatch) -> None:
    from raptix.orchestration.mission.task_budget import TaskBudgetMiddleware

    monkeypatch.setenv("RAPTIX_TASK_BUDGET", "1")
    backend = MemoryBackend()
    middleware = TaskBudgetMiddleware(backend=backend, call_limit=1)
    middleware.wrap_model_call(_model_request(), lambda _r: _response())
    saved = read_task_state(_scoped(backend), "A").state
    assert saved is not None
    assert [entry.action for entry in saved.decision_record] == ["budget_exhausted:calls"]


def test_broken_backend_leaves_response_unchanged(monkeypatch) -> None:
    from raptix.orchestration.mission.task_budget import TaskBudgetMiddleware

    monkeypatch.setenv("RAPTIX_TASK_BUDGET", "1")
    middleware = TaskBudgetMiddleware(backend=MemoryBackend(broken=True))
    response = _response(input_tokens=5)
    assert middleware.wrap_model_call(_model_request(), lambda _r: response) is response


def test_fold_is_revision_neutral_and_accumulates() -> None:
    from raptix.orchestration.mission.task_state import write_task_state

    backend = MemoryBackend()
    write_task_state(_scoped(backend), TaskState(objective_id="A", state_revision=4))
    fold_task_budget(backend, "A", model_calls=1, input_tokens=10, output_tokens=2)
    fold_task_budget(backend, "A", model_calls=2, input_tokens=5, output_tokens=1)
    saved = read_task_state(_scoped(backend), "A").state
    assert saved is not None
    assert saved.state_revision == 4
    assert saved.budget.model_calls == 3
    assert saved.budget.input_tokens == 15
    assert saved.budget.output_tokens == 3


def test_invalid_limit_env_fails_build_naming_variable(monkeypatch) -> None:
    from raptix.orchestration.mission.task_budget import budget_limits

    monkeypatch.setenv("RAPTIX_TASK_BUDGET_TOKENS", "lots")
    with pytest.raises(RuntimeError, match="RAPTIX_TASK_BUDGET_TOKENS"):
        budget_limits()
    monkeypatch.setenv("RAPTIX_TASK_BUDGET_TOKENS", "0")
    with pytest.raises(RuntimeError, match="RAPTIX_TASK_BUDGET_TOKENS"):
        budget_limits()
