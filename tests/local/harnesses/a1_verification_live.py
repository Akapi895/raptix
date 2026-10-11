"""Run inside an isolated Linux sandbox image with tmux and a fresh /workspace.

Stage the current runtime on PYTHONPATH, set RAPTIX_PLUGINS=__live__ and
RAPTIX_USE_SKILLOGY=0. No external targets or model calls are made. The short
timeout case changes the runner's deadline, not its output or implementation.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import threading
import time
from importlib import import_module
from pathlib import Path

import uvicorn

from raptix.execution.backends.factory import build_sandbox_backend
from raptix.execution.tools.evidence.tools import recheck_workspace_verification
from raptix.execution.tools.plumbing.verification import validate_workspace_finding
from raptix.middleware.filesystem import EngagementFilesystemBackend

CVSS = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
ROOT = "/workspace"


async def exercise(config: dict, state: dict) -> list[str]:
    remote = build_sandbox_backend(config)
    filesystem = EngagementFilesystemBackend(remote, ROOT)
    passed: list[str] = []

    async def run(finding: str, proof: str, control: str, expected: str) -> tuple[dict, str]:
        raw = await validate_workspace_finding.ainvoke(
            {
                "finding_id": finding,
                "poc_command": proof,
                "negative_command": control,
                "success_patterns": "PROOF-MARKER",
                "negative_patterns": "BASELINE",
                "cvss_vector": CVSS,
                "state": state,
            },
            config=config,
        )
        produced = json.loads(raw)
        assert "verification_ref" in produced, produced
        path = f"{ROOT}/findings/evidence/{finding}_verification.json"
        written = filesystem.write(path, raw)
        assert not written.error, written
        reread = json.loads(
            recheck_workspace_verification.invoke(
                {"finding_id": finding, "state": state},
                config=config,
            )
        )
        assert reread["verification"]["outcome"] == expected, reread
        if expected == "supported":
            assert produced["validated"] is True
        else:
            assert produced["validated"] is False
        passed.append(finding)
        return produced, raw

    supported, raw = await run(
        "FIND-PASS", "printf 'PROOF-MARKER\\n'", "printf 'BASELINE\\n'", "supported"
    )
    await run(
        "FIND-NOISE",
        "printf 'PROOF-MARKER\\n'",
        "printf 'BASELINE PROOF-MARKER\\n'",
        "contradicted",
    )
    await run(
        "FIND-ERROR", "printf 'PROOF-MARKER\\n'; false", "printf 'BASELINE\\n'", "inconclusive"
    )
    await run(
        "FIND-BASELINE-ERROR",
        "printf 'PROOF-MARKER\\n'",
        "printf 'BASELINE\\n'; false",
        "inconclusive",
    )
    await run(
        "FIND-TRUNCATED",
        "python3 -c \"print('PROOF-MARKER'); print('x' * 50000)\"",
        "printf 'BASELINE\\n'",
        "inconclusive",
    )

    # Two invocations of identical command text must remain separate captures.
    command = "if [ -f /workspace/trial ]; then printf 'BASELINE\\n'; else touch /workspace/trial; printf 'PROOF-MARKER\\n'; fi"
    await run("FIND-SAME-COMMAND", command, command, "supported")

    poc = import_module("raptix.execution.tools.research.poc")
    original_deadline = poc.POC_RUNNER_TIMEOUT_SECONDS
    try:
        poc.POC_RUNNER_TIMEOUT_SECONDS = 0.2
        await run(
            "FIND-TIMEOUT",
            "sleep 2; printf 'PROOF-MARKER\\n'",
            "printf 'BASELINE\\n'",
            "inconclusive",
        )
    finally:
        poc.POC_RUNNER_TIMEOUT_SECONDS = original_deadline
    await asyncio.sleep(2.5)  # allow the cancelled HTTP worker's harmless sleep to finish

    # Copying or relabelling the JSON cannot transplant a verdict to another finding.
    copied = json.loads(raw)
    copied["vuln_id"] = "FIND-COPY"
    assert not filesystem.write(
        f"{ROOT}/findings/evidence/FIND-COPY_verification.json", json.dumps(copied)
    ).error
    result = json.loads(
        recheck_workspace_verification.invoke(
            {"finding_id": "FIND-COPY", "state": state}, config=config
        )
    )
    assert result["verification"]["reason"] == "finding_binding_mismatch", result
    passed.append("finding-binding")

    # Integrity failure must be uncertainty, even when the persisted boolean was true.
    from raptix.execution.tools.evidence.artifacts import resolve_verification

    record = resolve_verification(
        supported["verification_ref"],
        sandbox=remote,
        workspace=ROOT,
        engagement=state["kg_engagement"],
    )
    proof_blob = (
        Path(ROOT) / "evidence/scanner-captures" / (record["proof_ref"].rsplit("/", 1)[-1] + ".bin")
    )
    proof_blob.write_bytes(b"tampered")
    result = json.loads(
        recheck_workspace_verification.invoke(
            {"finding_id": "FIND-PASS", "state": state}, config=config
        )
    )
    assert result["verification"]["outcome"] == "inconclusive", result
    assert result["verification"]["integrity"]["proof"] == "drift", result
    passed.append("tamper-drift")

    proof_blob.unlink()
    result = json.loads(
        recheck_workspace_verification.invoke(
            {"finding_id": "FIND-PASS", "state": state}, config=config
        )
    )
    assert result["verification"]["integrity"]["proof"] == "missing", result
    passed.append("missing-capture")
    remote.close()
    return passed


def main() -> None:
    assert os.environ.get("RAPTIX_WORKSPACE_ISOLATED") == "1"
    assert os.environ.get("RAPTIX_ENGAGEMENT", "").startswith("itest-"), "use a test engagement"
    assert not any(Path(ROOT).iterdir()), "use a fresh test volume, not an active workspace"
    os.environ["RAPTIX_KG_EVIDENCE_CAPTURE"] = "1"
    api = import_module("raptix.execution.sandbox.server.app")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        server = uvicorn.Server(uvicorn.Config(api.app, lifespan="on", log_level="error"))
        thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
        thread.start()
        for _ in range(200):
            if server.started:
                break
            time.sleep(0.02)
        assert server.started, "daemon did not start"
        config = {
            "configurable": {
                "sandbox_url": f"http://127.0.0.1:{listener.getsockname()[1]}",
                "sandbox_token": os.environ.get("SANDBOX_TOKEN"),
                "workspace_path": ROOT,
            }
        }
        state = {"kg_engagement": os.environ["RAPTIX_ENGAGEMENT"], "workspace_path": ROOT}
        try:
            passed = asyncio.run(exercise(config, state))
            print(json.dumps({"result": "PASS", "checks": passed}, sort_keys=True))
        finally:
            server.should_exit = True
            thread.join(10)
            assert not thread.is_alive(), "test daemon did not stop"


if __name__ == "__main__":
    main()
