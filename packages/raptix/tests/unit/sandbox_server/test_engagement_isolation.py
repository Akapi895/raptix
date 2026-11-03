"""A pinned engagement's workspace is /workspace/<slug>; the daemon refuses everything else."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from raptix.execution.tools.bash.bash import _workspace_path_from_config, bash_workspace
from raptix.orchestration.mission.engagement import EngagementContextMiddleware
from tests.unit.sandbox_server.test_app import _client, _make_backend


@pytest.fixture(autouse=True)
def unpinned(monkeypatch):
    for name in ("RAPTIX_ENGAGEMENT", "RAPTIX_WORKSPACE_PATH"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("os.makedirs", lambda *args, **kwargs: None)
    monkeypatch.setattr("os.path.isdir", lambda path: False)


@pytest.mark.parametrize(
    ("route", "body"),
    [
        ("/execute_tmux", {"command": "true", "workspace_path": "/workspace"}),
        ("/execute_tmux", {"command": "true", "workspace_path": "/workspace/lab-b"}),
        ("/start_background", {"command": "true", "workspace_path": "/workspace"}),
        ("/start_background", {"command": "true", "workspace_path": "/workspace/lab-b"}),
        ("/workspace/ensure", {"path": "/workspace"}),
        ("/workspace/ensure", {"path": "/workspace/lab-b"}),
    ],
)
def test_pinned_engagement_refuses_any_other_workspace(monkeypatch, route, body):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    with _client(_make_backend()) as client:
        response = client.post(route, json=body)
    assert response.status_code == 403


def test_pinned_engagement_accepts_its_own_workspace(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    with _client(_make_backend()) as client:
        response = client.post(
            "/execute_tmux", json={"command": "true", "workspace_path": "/workspace/lab-a"}
        )
    assert response.status_code == 200


def test_bash_context_accepts_pinned_engagement_workspace(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    with bash_workspace("/workspace/lab-a"):
        assert _workspace_path_from_config(None) == "/workspace/lab-a"


def test_bash_context_rejects_shared_root_for_a_pinned_engagement(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    with pytest.raises(RuntimeError, match="outside engagement 'lab-a'"):
        with bash_workspace("/workspace"):
            pass


def test_context_rejects_a_workspace_outside_the_project_volume_without_pin():
    # ADR-0102: without an operator pin, a run works under the project's /workspace and nowhere else.
    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        state={"engagement_name": "lab-a", "workspace_path": "/home/other"},
    )
    with pytest.raises(RuntimeError, match="outside the project workspace"):
        EngagementContextMiddleware().wrap_tool_call(request, lambda request: "executed")


def test_pinned_daemon_rejects_file_outside_workspace(monkeypatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-a")
    with _client(_make_backend()) as client:
        response = client.post("/download_files", json={"paths": ["/etc/passwd"]})
    assert response.status_code == 403
