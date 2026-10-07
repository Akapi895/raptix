"""Engagement workspace fence tests for the bash tool family.

The fence (plan D2, docs/design/2026-10-07-run-isolation-reproducibility-plan.md)
is env-based enforcement: when ``RAPTIX_ENGAGEMENT`` is set, every resolved
workspace - via run config, env fallback, or ``bash_workspace()`` - must live
inside ``/workspace/<slug>/`` or the tool errors. The shared ``/workspace``
root is refused too: it is the tree every engagement sees when no
per-engagement bind-mount is in play.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from raptix.execution.tools.bash.bash import (
    _ensure_workspace_dir,
    _workspace_path_from_config,
    bash,
    bash_workspace,
    set_sandbox,
)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("RAPTIX_ENGAGEMENT", raising=False)
    monkeypatch.delenv("RAPTIX_WORKSPACE_PATH", raising=False)


@pytest.fixture(autouse=True)
def _isolated_ensure_cache():
    # importlib (not `import a.b.c as x`): the tools/bash package __init__
    # re-exports the `bash` StructuredTool, which shadows the submodule
    # attribute and breaks the as-import form.
    import importlib

    bash_module = importlib.import_module("raptix.execution.tools.bash.bash")
    bash_module._ensured_workspaces.clear()
    yield
    bash_module._ensured_workspaces.clear()


def _config(workspace_path: str) -> dict:
    return {"configurable": {"workspace_path": workspace_path}}


# -- bash_workspace (orchestrator entry) --


def test_bash_workspace_allows_inside_engagement(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    with bash_workspace("/workspace/lab-01"):
        assert _workspace_path_from_config(None) == "/workspace/lab-01"


def test_bash_workspace_rejects_other_engagement(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    with pytest.raises(RuntimeError, match="outside engagement 'lab-01'"):
        with bash_workspace("/workspace/lab-02"):
            pass


def test_bash_workspace_rejects_shared_root(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    with pytest.raises(RuntimeError, match="outside engagement"):
        with bash_workspace("/workspace"):
            pass


def test_bash_workspace_inactive_without_env(monkeypatch) -> None:
    with bash_workspace("/workspace/lab-99"):
        assert _workspace_path_from_config(None) == "/workspace/lab-99"


def test_bash_workspace_rejects_invalid_slug_env(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "../escape")
    with pytest.raises(RuntimeError, match="not a valid engagement slug"):
        with bash_workspace("/workspace/lab-01"):
            pass


# -- _workspace_path_from_config (per-call resolution) --


def test_config_workspace_outside_engagement_raises(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    with pytest.raises(RuntimeError, match="outside engagement 'lab-01'"):
        _workspace_path_from_config(_config("/workspace/lab-02"))


def test_env_workspace_outside_engagement_raises(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    monkeypatch.setenv("RAPTIX_WORKSPACE_PATH", "/workspace/lab-02")
    with pytest.raises(RuntimeError, match="outside engagement 'lab-01'"):
        _workspace_path_from_config(None)


def test_env_slug_resolution_still_works(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    assert _workspace_path_from_config(None) == "/workspace/lab-01"


def test_no_env_keeps_legacy_resolution(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_WORKSPACE_PATH", "/workspace/lab-02")
    assert _workspace_path_from_config(None) == "/workspace/lab-02"


def test_fence_rejects_subpath_of_another_engagement(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    with pytest.raises(RuntimeError, match="outside engagement"):
        _workspace_path_from_config(_config("/workspace/lab-02/output"))


# -- enforcement reaches the tool --


def test_bash_tool_refuses_cross_engagement_workspace(monkeypatch) -> None:
    # Env-based misconfig: RAPTIX_WORKSPACE_PATH points at another
    # engagement's dir while the fence slug says lab-01. The bash tool
    # must raise before any command reaches the sandbox.
    monkeypatch.setenv("RAPTIX_ENGAGEMENT", "lab-01")
    monkeypatch.setenv("RAPTIX_WORKSPACE_PATH", "/workspace/lab-02")
    sandbox = MagicMock()
    set_sandbox(sandbox)
    import asyncio

    with pytest.raises(RuntimeError, match="outside engagement 'lab-01'"):
        asyncio.run(
            bash.ainvoke(
                {
                    "command": "ls /workspace/lab-02",
                    "description": "peek at another engagement",
                }
            )
        )
    sandbox.execute_tmux.assert_not_called()


# -- eager workspace ensure (best-effort) --


def test_ensure_workspace_dir_calls_daemon_once_per_path() -> None:
    sandbox = MagicMock()
    sandbox.id = "http-sandbox:http://sandbox:9999"
    _ensure_workspace_dir("/workspace/lab-01", sandbox)
    _ensure_workspace_dir("/workspace/lab-01", sandbox)
    sandbox.ensure_workspace.assert_called_once_with("/workspace/lab-01")


def test_ensure_workspace_dir_retries_after_failure() -> None:
    sandbox = MagicMock()
    sandbox.id = "http-sandbox:x"
    sandbox.ensure_workspace.side_effect = RuntimeError("daemon restarting")
    _ensure_workspace_dir("/workspace/lab-01", sandbox)  # must not raise
    _ensure_workspace_dir("/workspace/lab-01", sandbox)
    assert sandbox.ensure_workspace.call_count == 2


def test_ensure_workspace_dir_skips_root_and_none() -> None:
    _ensure_workspace_dir("/workspace", None)
    _ensure_workspace_dir("/workspace", MagicMock())
