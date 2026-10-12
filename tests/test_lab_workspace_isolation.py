"""Docker Desktop aliases must preserve the lab harness's isolation invariant."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


def test_egress_compiler_imports_without_initializing_agents() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-B",
            "-c",
            "from raptix.middleware.egress import compile_egress_policy; print('EGRESS_IMPORT_OK')",
        ],
        env={**os.environ, "RAPTIX_SKIP_BOOT": "1", "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert "EGRESS_IMPORT_OK" in result.stdout


@pytest.mark.parametrize(
    ("sandbox_source", "langgraph_source", "accepted"),
    [
        (
            "D:/.VTNet/redteam/raptix/.raptix/workspace/lab-smoke",
            "/run/desktop/mnt/host/d/.VTNet/redteam/raptix/.raptix/workspace/lab-smoke",
            True,
        ),
        ("D:/first/workspace/lab-smoke", "D:/second/workspace/lab-smoke", False),
        ("D:/workspace/lab-smoke", "/run/desktop/mnt/host/e/workspace/lab-smoke", False),
    ],
)
def test_actual_mounts_must_identify_the_same_engagement(
    sandbox_source: str, langgraph_source: str, accepted: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    spec = importlib.util.spec_from_file_location(
        "lab_runner_isolation", Path(__file__).parent / "local/harnesses/lab_run.py"
    )
    assert spec is not None and spec.loader is not None
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    sources = {"sandbox": sandbox_source, "langgraph": langgraph_source}

    def inspect(args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
        payload = {
            "Config": {"Env": ["RAPTIX_ENGAGEMENT=lab-smoke", "RAPTIX_WORKSPACE_ISOLATED=1"]},
            "Mounts": [{"Type": "bind", "Source": sources[args[1]], "Destination": "/workspace"}],
        }
        return subprocess.CompletedProcess(args, 0, stdout=json.dumps(payload))

    monkeypatch.setattr(runner, "_docker", inspect)
    args = argparse.Namespace(
        engagement="lab-smoke",
        container_workspace="/workspace",
        sandbox_container="sandbox",
        langgraph_container="langgraph",
    )
    if accepted:
        assert runner._verify_workspace_isolation(args)["verdict"] == "ok"
    else:
        with pytest.raises(SystemExit, match="same engagement directory"):
            runner._verify_workspace_isolation(args)
