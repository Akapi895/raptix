"""Reject unisolated engagement operations before the daemon touches a backend."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from raptix.execution.tools.bash.bash import _workspace_path_from_config, bash_workspace
from raptix.orchestration.mission.engagement import EngagementContextMiddleware
from tests.unit.sandbox_server.test_app import _client, _make_backend


@pytest.fixture(autouse=True)
def unpinned(monkeypatch):
    for name in ("RAPTIX_ENGAGEMENT", "RAPTIX_WORKSPACE_ISOLATED", "RAPTIX_WORKSPACE_PATH"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("os.makedirs", lambda *args, **kwargs: None)
    monkeypatch.setattr("os.path.isdir", lambda path: False)


@pytest.mark.parametrize(
    ("route", "body"),
    [
        ("/execute", {"command": "cat /workspace/lab-b/canary"}),
        (
            "/execute_tmux",
            {"command": "cat /workspace/lab-b/canary", "workspace_path": "/workspace/lab-a"},
        ),
        ("/start_background", {"command": "true", "workspace_path": "/workspace/lab-a"}),
        ("/upload_files", {"files": []}),
        ("/download_files", {"paths": []}),
        ("/poll_completion", {"session": "main"}),
        ("/kill_session", {"session": "main"}),
        ("/read_session_log_diff", {"session": "main"}),
        ("/reset_session_log_offset", {"session": "main"}),
        ("/session_log_path", {"session": "main"}),
        ("/workspace/ensure", {"path": "/workspace/lab-a"}),
    ],
)
def test_named_engagement_requires_isolated_mount(monkeypatch, route, body):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    with _client(_make_backend()) as client:
        response = client.post(route, json=body)
    assert response.status_code == 403


def test_bash_context_accepts_pinned_mount_root(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    monkeypatch.setenv("RAPTIX_WORKSPACE_ISOLATED", "1")
    with bash_workspace("/workspace"):
        assert _workspace_path_from_config(None) == "/workspace"


def test_bash_context_rejects_named_shared_tree(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    with pytest.raises(RuntimeError, match="isolated"):
        with bash_workspace("/workspace/lab-a"):
            pass


def test_context_rejects_runtime_engagement_without_deployment_pin():
    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        state={"engagement_name": "lab-a", "workspace_path": "/workspace/lab-a"},
    )
    with pytest.raises(RuntimeError, match="pinned engagement"):
        EngagementContextMiddleware().wrap_tool_call(request, lambda request: "executed")


def test_pinned_daemon_rejects_wrong_runtime_root(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    monkeypatch.setenv("RAPTIX_WORKSPACE_ISOLATED", "1")
    with _client(_make_backend()) as client:
        response = client.post(
            "/execute_tmux", json={"command": "true", "workspace_path": "/workspace/lab-b"}
        )
    assert response.status_code == 403


def test_pinned_daemon_rejects_file_outside_workspace(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    monkeypatch.setenv("RAPTIX_WORKSPACE_ISOLATED", "1")
    with _client(_make_backend()) as client:
        response = client.post("/download_files", json={"paths": ["/etc/passwd"]})
    assert response.status_code == 403
