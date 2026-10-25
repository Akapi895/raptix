"""ProjectFiles reaches a project's files only through its sandbox daemon (ADR-0102).

The fake daemon answers the same way the sandbox kernel does: a missing path is ``file_not_found``, a path over
``max_bytes`` is ``file_too_large``, and an upload creates parent directories. Transport failures raise as httpx does.
"""

from __future__ import annotations

import shlex

import httpx
import pytest
from deepagents.backends.protocol import ExecuteResponse, FileDownloadResponse, FileUploadResponse

from raptix.execution.backends.http_sandbox import SandboxError
from raptix.execution.backends.project_files import ProjectFiles, ProjectFileUnavailable


class FakeDaemon:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.refuse_path: str | None = None
        self.download_error: str | None = None
        self.transport_error: Exception | None = None
        self.exit_code = 0
        self.commands: list[str] = []

    def _maybe_fail(self) -> None:
        if self.transport_error is not None:
            raise self.transport_error

    def download_files(self, paths, *, workspace_path=None, max_bytes=None):
        self._maybe_fail()
        responses = []
        for path in paths:
            if self.download_error is not None:
                responses.append(
                    FileDownloadResponse(path=path, content=None, error=self.download_error)
                )
                continue
            if path not in self.files:
                responses.append(
                    FileDownloadResponse(path=path, content=None, error="file_not_found")
                )
                continue
            data = self.files[path]
            if max_bytes is not None and len(data) > max_bytes:
                responses.append(
                    FileDownloadResponse(path=path, content=None, error="file_too_large")
                )
                continue
            responses.append(FileDownloadResponse(path=path, content=data, error=None))
        return responses

    def upload_files(self, files, *, workspace_path=None):
        self._maybe_fail()
        responses = []
        for path, data in files:
            if path == self.refuse_path:
                responses.append(FileUploadResponse(path=path, error="permission_denied"))
                continue
            self.files[path] = data
            responses.append(FileUploadResponse(path=path, error=None))
        return responses

    def execute(self, command, *, timeout=None):
        self._maybe_fail()
        self.commands.append(command)
        return ExecuteResponse(output="", exit_code=self.exit_code, truncated=False)


def _files(daemon: FakeDaemon) -> ProjectFiles:
    return ProjectFiles(daemon)  # type: ignore[arg-type]


def test_read_returns_the_stored_bytes_at_the_workspace_path():
    daemon = FakeDaemon()
    daemon.files["/workspace/plan/roe.json"] = b'{"a":1}'
    assert _files(daemon).read_bytes("plan/roe.json") == b'{"a":1}'


def test_read_returns_none_for_a_file_the_daemon_reports_absent():
    assert _files(FakeDaemon()).read_bytes("plan/roe.json") is None


def test_read_refuses_when_the_daemon_reports_a_real_error():
    daemon = FakeDaemon()
    daemon.download_error = "permission_denied"
    with pytest.raises(ProjectFileUnavailable):
        _files(daemon).read_bytes("plan/roe.json")


def test_read_refuses_when_the_sandbox_cannot_be_reached():
    daemon = FakeDaemon()
    daemon.transport_error = httpx.ConnectError("sandbox is down")
    with pytest.raises(ProjectFileUnavailable):
        _files(daemon).read_bytes("plan/roe.json")


def test_read_refuses_when_the_sandbox_answers_with_an_error_status():
    daemon = FakeDaemon()
    daemon.transport_error = SandboxError("Sandbox returned 401")
    with pytest.raises(ProjectFileUnavailable):
        _files(daemon).read_bytes("plan/roe.json")


def test_exists_is_false_only_when_the_daemon_reports_the_path_absent():
    assert _files(FakeDaemon()).exists(".abort") is False


def test_exists_is_true_for_an_empty_file_and_for_a_file_over_the_probe_bound():
    daemon = FakeDaemon()
    daemon.files["/workspace/.abort"] = b""
    daemon.files["/workspace/audit/roe-decisions.jsonl"] = b"x"
    assert _files(daemon).exists(".abort") is True
    assert _files(daemon).exists("audit/roe-decisions.jsonl") is True


def test_exists_refuses_rather_than_reporting_absent_when_the_probe_fails():
    daemon = FakeDaemon()
    daemon.download_error = "permission_denied"
    with pytest.raises(ProjectFileUnavailable):
        _files(daemon).exists(".abort")


def test_write_stores_the_bytes_and_refuses_a_rejected_upload():
    daemon = FakeDaemon()
    _files(daemon).write_bytes("plan/conops.json", b"{}")
    assert daemon.files["/workspace/plan/conops.json"] == b"{}"
    daemon.refuse_path = "/workspace/plan/roe.json"
    with pytest.raises(ProjectFileUnavailable):
        _files(daemon).write_bytes("plan/roe.json", b"{}")


def test_append_stages_the_bytes_and_concatenates_them_in_the_sandbox():
    daemon = FakeDaemon()
    _files(daemon).append_bytes("audit/roe-decisions.jsonl", b"line-1\n")
    staged = [path for path in daemon.files if "/.append-" in path]
    assert len(staged) == 1 and daemon.files[staged[0]] == b"line-1\n"
    (command,) = daemon.commands
    assert shlex.quote(staged[0]) in command
    assert f">> {shlex.quote('/workspace/audit/roe-decisions.jsonl')}" in command
    assert f"rm -f -- {shlex.quote(staged[0])}" in command


def test_append_refuses_when_the_sandbox_command_fails():
    daemon = FakeDaemon()
    daemon.exit_code = 1
    with pytest.raises(ProjectFileUnavailable):
        _files(daemon).append_bytes("audit/roe-decisions.jsonl", b"line\n")


@pytest.mark.parametrize(
    "rel", ["", "/plan/roe.json", "plan/../roe.json", "plan//roe.json", "./roe.json"]
)
def test_paths_outside_the_project_root_are_rejected_before_any_request(rel):
    daemon = FakeDaemon()
    with pytest.raises(ValueError):
        _files(daemon).read_bytes(rel)
    assert daemon.files == {} and daemon.commands == []
