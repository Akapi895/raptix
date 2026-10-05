"""Manual B0 gate: prove two real sandbox tmux sessions stay isolated.

Run only against an explicitly started isolated stack::

    RAPTIX_B0_LIVE=1 SANDBOX_URL=http://sandbox:9999 \
      uv run pytest -s tests/local/manual/test_b0_session_isolation_live.py

The test deliberately uses ``raptix.tools.bash.bash.ainvoke`` rather than
calling the sandbox transport directly. This is the same bash-tool path used
by specialist tasks, without weakening the production orchestrator's
one-surface-exploit-task-per-turn rule.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass

import pytest

from raptix.backends.factory import build_sandbox_backend
from raptix.tools.bash.bash import bash, bash_kill, set_sandbox

pytestmark = [pytest.mark.slow, pytest.mark.manual]

_WORKSPACE = "/workspace"
_SLEEP_SECONDS = 1
_ARTIFACT_WAIT_SECONDS = 3.0


@dataclass(frozen=True)
class _CellEvidence:
    cell: str
    session: str
    marker_path: str
    log_path: str
    marker: dict[str, object]
    output: str
    log: str


def _marker_command(cell: str, session: str, run_id: str) -> str:
    return (
        f"mkdir -p se/{cell} && cd se/{cell} && "
        "start_ns=$(date +%s%N) && "
        f"sleep {_SLEEP_SECONDS} && "
        "end_ns=$(date +%s%N) && "
        f'printf \'{{"cell":"{cell}","session":"{session}","run_id":"{run_id}",'
        '"cwd":"%s","start_ns":%s,"end_ns":%s}\n\' '
        f'"$PWD" "$start_ns" "$end_ns" > marker-{run_id}.json && '
        f"cat marker-{run_id}.json"
    )


async def _read_artifact(sandbox, path: str) -> str:
    """Wait for the daemon to expose an artifact created in the tmux session."""
    deadline = time.monotonic() + _ARTIFACT_WAIT_SECONDS
    while time.monotonic() < deadline:
        response = (await asyncio.to_thread(sandbox.download_files, [path]))[0]
        if response.error is None and response.content is not None:
            return response.content.decode("utf-8")
        await asyncio.sleep(0.05)
    return ""


async def _run_cell(cell: str, session: str, run_id: str) -> _CellEvidence:
    output = await bash.ainvoke(
        {
            "command": _marker_command(cell, session, run_id),
            "session": session,
            "timeout": 15,
            "description": f"B0 isolation marker for {cell}",
        },
        config={"configurable": {"workspace_path": _WORKSPACE}},
    )
    assert isinstance(output, str)

    sandbox = build_sandbox_backend()
    marker_path = f"{_WORKSPACE}/se/{cell}/marker-{run_id}.json"
    log_path = sandbox.session_log_path(session=session, workspace_path=_WORKSPACE)
    marker_text = await _read_artifact(sandbox, marker_path)
    assert marker_text, f"{session} did not create {marker_path}"
    marker = json.loads(marker_text)
    assert isinstance(marker, dict)
    return _CellEvidence(
        cell=cell,
        session=session,
        marker_path=marker_path,
        log_path=log_path,
        marker=marker,
        output=output,
        log=await _read_artifact(sandbox, log_path),
    )


@pytest.mark.asyncio
async def test_b0_real_sessions_overlap_without_cross_session_state() -> None:
    """Gate B6 fan-out on real tmux overlap and isolated cell artifacts."""
    if os.environ.get("RAPTIX_B0_LIVE") != "1":
        pytest.skip("manual gate: set RAPTIX_B0_LIVE=1 against an isolated stack")
    if not os.environ.get("SANDBOX_URL"):
        pytest.skip("manual gate: set SANDBOX_URL to the isolated sandbox daemon")

    sandbox = build_sandbox_backend()
    set_sandbox(sandbox)
    run_id = uuid.uuid4().hex
    cell_a, cell_b = await asyncio.gather(
        _run_cell("b0-a", "se-b0-a", run_id),
        _run_cell("b0-b", "se-b0-b", run_id),
    )

    evidence = (cell_a, cell_b)
    failures: list[str] = []
    for item in evidence:
        for signal in ("[TIMEOUT]", "[STALE]", "[ERROR]"):
            if signal in item.output:
                failures.append(f"{item.session} returned {signal}")
        if item.marker["cell"] != item.cell or item.marker["session"] != item.session:
            failures.append(f"{item.session} marker identity does not match its cell")
        if item.marker.get("run_id") != run_id:
            failures.append(f"{item.session} marker is stale or belongs to another B0 run")
        if item.marker["cwd"] != f"{_WORKSPACE}/se/{item.cell}":
            failures.append(f"{item.session} marker has an unexpected cwd")
        if not isinstance(item.marker["start_ns"], int) or not isinstance(
            item.marker["end_ns"], int
        ):
            failures.append(f"{item.session} marker timestamps are invalid")
        elif item.marker["start_ns"] >= item.marker["end_ns"]:
            failures.append(f"{item.session} marker interval is invalid")
        if not item.marker_path.endswith(f"marker-{run_id}.json"):
            failures.append(f"{item.session} marker path does not belong to this B0 run")

    # Real overlap: both sandbox-side sleep intervals must intersect.
    latest_start = max(int(item.marker["start_ns"]) for item in evidence)
    earliest_end = min(int(item.marker["end_ns"]) for item in evidence)
    if latest_start >= earliest_end:
        failures.append("the two real tmux sessions did not overlap")

    # Session logs are the shell-history evidence for this gate. Each log must
    # contain its own marker but never the other cell's marker/session identity.
    for item, other in ((cell_a, cell_b), (cell_b, cell_a)):
        marker_view = json.dumps(item.marker, sort_keys=True)
        if other.cell in marker_view or other.session in marker_view:
            failures.append(f"{item.session} marker contains {other.session} state")
        if item.log:
            if item.cell not in item.log or item.session not in item.log:
                failures.append(f"{item.session} log lacks its own cell identity")
            if other.cell in item.log or other.session in item.log:
                failures.append(f"{item.session} log contains {other.session} state")
            if "[STALE]" in item.log:
                failures.append(f"{item.session} log contains [STALE]")

    print(
        "B0_EVIDENCE="
        + json.dumps(
            {
                "result": "go" if not failures else "no-go",
                "failures": failures,
                "overlap_ns": [latest_start, earliest_end],
                "cells": [
                    {
                        "cell": item.cell,
                        "session": item.session,
                        "marker": item.marker,
                        "marker_path": item.marker_path,
                        "log_path": item.log_path,
                        "log_bytes": len(item.log),
                        "session_log": "present" if item.log else "absent",
                    }
                    for item in evidence
                ],
            },
            sort_keys=True,
        )
    )
    # Preserve the session logs, then remove the live tmux sessions so this
    # manual gate cannot influence a later engagement or B0 rerun.
    await asyncio.gather(
        *(
            bash_kill.ainvoke(
                {"session": item.session},
                config={"configurable": {"workspace_path": _WORKSPACE}},
            )
            for item in evidence
        )
    )
    assert not failures, "B0 gate failed; see B0_EVIDENCE output"
