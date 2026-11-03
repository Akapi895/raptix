"""Planner documents are schema-checked at write time, not only at handoff."""

from __future__ import annotations

import json

from deepagents.backends.protocol import EditResult, FileDownloadResponse, WriteResult

from raptix.middleware.filesystem import EngagementFilesystemBackend

ROOT = "/workspace/reddish"
ABORT = f"{ROOT}/plan/abort.json"
VALID_ABORT = json.dumps(
    {
        "engagement_name": "reddish",
        "halt_triggers": [
            {"condition": "SOC real-incident alert", "severity": "emergency", "response_action": "halt"},
            {"condition": "Scope violation", "severity": "critical", "response_action": "halt"},
        ],
    }
)
UPPERCASE_SEVERITY_ABORT = VALID_ABORT.replace('"emergency"', '"EMERGENCY"')


class MemoryBackend:
    def __init__(self) -> None:
        self.files: dict[str, str] = {}
        self.writes: list[str] = []
        self.edits: list[str] = []

    def write(self, file_path: str, content: str) -> WriteResult:
        self.writes.append(file_path)
        if file_path in self.files:
            return WriteResult(error="File already exists")
        self.files[file_path] = content
        return WriteResult(path=file_path)

    def edit(self, file_path: str, old_string: str, new_string: str, replace_all: bool = False) -> EditResult:
        self.edits.append(file_path)
        text = self.files.get(file_path)
        if text is None or old_string not in text:
            return EditResult(error="old_string not found")
        self.files[file_path] = text.replace(old_string, new_string) if replace_all else text.replace(old_string, new_string, 1)
        return EditResult(path=file_path)

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        return [
            FileDownloadResponse(path=path, content=self.files[path].encode()) if path in self.files
            else FileDownloadResponse(path=path, content=None, error="file_not_found")
            for path in paths
        ]


def _backend(files: dict[str, str] | None = None) -> tuple[EngagementFilesystemBackend, MemoryBackend]:
    memory = MemoryBackend()
    memory.files.update(files or {})
    return EngagementFilesystemBackend(memory, ROOT), memory


def test_refuses_plan_document_that_breaks_its_schema_without_writing() -> None:
    backend, memory = _backend()

    result = backend.write("/workspace/plan/abort.json", UPPERCASE_SEVERITY_ABORT)

    assert result.error is not None
    assert "plan/abort.json: halt_triggers.0.severity:" in result.error
    assert "(got 'EMERGENCY')" in result.error
    assert ABORT not in memory.writes
    assert ABORT not in memory.files


def test_accepts_valid_plan_document() -> None:
    backend, memory = _backend()

    result = backend.write("/workspace/plan/abort.json", VALID_ABORT)

    assert result.error is None
    assert memory.files[ABORT] == VALID_ABORT


def test_ignores_non_planning_files_even_when_they_look_like_plans() -> None:
    backend, memory = _backend()

    result = backend.write("/workspace/notes/plan/abort.json", UPPERCASE_SEVERITY_ABORT)

    assert result.error is None
    assert f"{ROOT}/notes/plan/abort.json" in memory.files


def test_edit_refuses_change_that_breaks_a_valid_plan_document() -> None:
    backend, memory = _backend({ABORT: VALID_ABORT})

    result = backend.edit("/workspace/plan/abort.json", '"emergency"', '"EMERGENCY"')

    assert result.error is not None
    assert "plan/abort.json: halt_triggers.0.severity:" in result.error
    assert memory.edits == []
    assert memory.files[ABORT] == VALID_ABORT


def test_edit_allows_piecemeal_repair_of_an_already_invalid_plan_document() -> None:
    backend, memory = _backend({ABORT: UPPERCASE_SEVERITY_ABORT.replace('"critical"', '"CRITICAL"')})

    result = backend.edit("/workspace/plan/abort.json", '"EMERGENCY"', '"emergency"')

    assert result.error is None
    assert memory.edits == [ABORT]
    assert '"CRITICAL"' in memory.files[ABORT]


def test_edit_applies_valid_change_to_plan_document() -> None:
    backend, memory = _backend({ABORT: VALID_ABORT})

    result = backend.edit("/workspace/plan/abort.json", '"Scope violation"', '"Out-of-scope traffic"')

    assert result.error is None
    assert memory.edits == [ABORT]
    assert "Out-of-scope traffic" in memory.files[ABORT]
