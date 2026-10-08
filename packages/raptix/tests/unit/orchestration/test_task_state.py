"""Durable per-objective task state: round trip, bounding, fail-safe reads."""

from __future__ import annotations

from deepagents.backends.protocol import (
    EditResult,
    LsResult,
    ReadResult,
    WriteResult,
)

from raptix.execution.tools.opplan import _persist_opplan_to_backend
from raptix.orchestration.mission.task_state import (
    Budget,
    DecisionRecord,
    EvidenceRef,
    TaskState,
    advance_task_state,
    persist_task_state_for_objectives,
    read_task_state,
    task_state_path,
    work_status_for,
    write_task_state,
)


class MemoryBackend:
    """Minimal in-memory BackendProtocol honouring the read/write/edit contract."""

    def __init__(self, files: dict[str, str] | None = None) -> None:
        self.files = dict(files or {})

    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        if file_path not in self.files:
            return ReadResult(error=f"file_not_found: '{file_path}'")
        return ReadResult(
            file_data={
                "content": self.files[file_path][offset : offset + limit],
                "encoding": "utf-8",
            }
        )

    def write(self, file_path: str, content: str) -> WriteResult:
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> EditResult:
        if file_path not in self.files:
            return EditResult(error=f"Path '{file_path}': not_found")
        self.files[file_path] = self.files[file_path].replace(old_string, new_string)
        return EditResult(path=file_path, occurrences=1)

    def ls_info(self, path: str) -> list:
        return []

    def ls(self, path: str) -> LsResult:
        return LsResult(entries=[])


def _objective(objective_id: str = "OBJ-001", *, status: str = "pending", notes: str = "") -> dict:
    return {
        "id": objective_id,
        "title": "Recon the perimeter",
        "phase": "recon",
        "description": "Enumerate exposed services.",
        "acceptance_criteria": ["nmap output captured"],
        "priority": 1,
        "status": status,
        "notes": notes,
        "owner": "",
    }


def test_round_trip_and_revision_is_monotonic() -> None:
    backend = MemoryBackend()
    first = write_task_state(
        backend, advance_task_state(_objective(status="in-progress"), prior=None)
    )
    assert first is None
    loaded = read_task_state(backend, "OBJ-001")
    assert loaded.error is None
    assert loaded.state is not None
    assert loaded.state.state_revision == 1
    assert loaded.state.work_state.status.value == "running"

    write_task_state(
        backend,
        advance_task_state(_objective(status="completed", notes="done"), prior=loaded.state),
    )
    second = read_task_state(backend, "OBJ-001").state
    assert second is not None
    assert second.state_revision == 2
    assert second.work_state.status.value == "completed"
    assert second.work_state.reason == "done"


def test_bounded_sections_keep_most_recent() -> None:
    state = TaskState(objective_id="OBJ-001")
    state.evidence_refs = [EvidenceRef(ref=f"evidence/{i}") for i in range(120)]
    state.decision_record = [DecisionRecord(action=f"a{i}", outcome="x") for i in range(120)]
    state.bounded()
    assert len(state.evidence_refs) == 50
    assert state.evidence_refs[-1].ref == "evidence/119"
    assert len(state.decision_record) == 50
    assert state.decision_record[-1].action == "a119"


def test_missing_file_is_empty_bundle() -> None:
    bundle = read_task_state(MemoryBackend(), "OBJ-404")
    assert bundle.state is None
    assert bundle.error is None


def test_malformed_file_reports_error_without_crash() -> None:
    backend = MemoryBackend({task_state_path("OBJ-001"): "{not json"})
    bundle = read_task_state(backend, "OBJ-001")
    assert bundle.state is None
    assert bundle.error is not None
    assert "malformed task state" in bundle.error


def test_flag_off_writes_nothing(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_TASK_STATE", raising=False)
    backend = MemoryBackend()
    persist_task_state_for_objectives(backend, [_objective()])
    assert backend.files == {}


def test_objective_transition_persists_task_state_when_enabled(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_TASK_STATE", "1")
    backend = MemoryBackend()
    _persist_opplan_to_backend(
        backend, "/workspace", [_objective(status="in-progress")], "lab", "profile"
    )
    # The scoped backend maps /workspace identity, so the task-state file lands
    # at the virtual path.
    assert "/workspace/plan/task-state/OBJ-001.json" in backend.files
    loaded = read_task_state(backend, "OBJ-001").state
    assert loaded is not None
    assert loaded.work_state.status.value == "running"
    assert loaded.state_revision == 1


def test_flag_off_keeps_opplan_write_but_no_task_state(monkeypatch) -> None:
    monkeypatch.delenv("RAPTIX_TASK_STATE", raising=False)
    backend = MemoryBackend()
    _persist_opplan_to_backend(backend, "/workspace", [_objective()], "lab", "profile")
    assert "/workspace/plan/opplan.json" in backend.files
    assert "/workspace/plan/task-state/OBJ-001.json" not in backend.files


def test_carries_sections_and_budget_forward() -> None:
    prior = TaskState(objective_id="OBJ-001")
    prior.evidence_refs = [EvidenceRef(ref="evidence/scan.xml", sha256="a" * 64)]
    prior.decision_record = [DecisionRecord(action="nmap", outcome="success")]
    prior.budget = Budget(model_calls=3, attempts=2)
    advanced = advance_task_state(_objective(status="blocked", notes="no route"), prior=prior)
    assert advanced.evidence_refs[0].ref == "evidence/scan.xml"
    assert advanced.decision_record[0].action == "nmap"
    assert advanced.budget.attempts == 2
    assert advanced.work_state.status.value == "blocked"


def test_cancelled_objective_maps_to_exhausted() -> None:
    assert work_status_for("cancelled").value == "exhausted"
    assert work_status_for("weird").value == "pending"
