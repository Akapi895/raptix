"""A2 live: promote a workspace verification into a real Neo4j KG, then inspect.

Runs inside an isolated Linux sandbox image attached to the Neo4j network (real
Neo4j, real HTTP daemon, real tmux, real filesystem). Stage the runtime on
PYTHONPATH; set RAPTIX_PLUGINS=__live__, RAPTIX_USE_SKILLOGY=0, RAPTIX_ENGAGEMENT
(test slug), RAPTIX_NEO4J_* and SANDBOX_TOKEN. No external targets.
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
from raptix.execution.tools.evidence.tools import (
    inspect_evidence,
    recheck_workspace_verification,
    record_workspace_finding,
)
from raptix.execution.tools.plumbing.verification import validate_workspace_finding
from raptix.knowledge.graph.store import KGStore
from raptix.middleware.filesystem import EngagementFilesystemBackend

CVSS = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
ROOT = "/workspace"


async def exercise(config: dict, state: dict) -> list[str]:
    remote = build_sandbox_backend(config)
    filesystem = EngagementFilesystemBackend(remote, ROOT)
    passed: list[str] = []

    raw = await validate_workspace_finding.ainvoke(
        {
            "finding_id": "FIND-A2",
            "poc_command": "printf 'PROOF-MARKER\\n'",
            "negative_command": "printf 'BASELINE\\n'",
            "success_patterns": "PROOF-MARKER",
            "negative_patterns": "BASELINE",
            "cvss_vector": CVSS,
            "state": state,
        },
        config=config,
    )
    path = f"{ROOT}/findings/evidence/FIND-A2_verification.json"
    assert not filesystem.write(path, raw).error
    assert json.loads(raw)["validated"] is True

    promoted = json.loads(
        record_workspace_finding.invoke({"finding_id": "FIND-A2", "state": state}, config=config)
    )
    assert promoted["verification_outcome"] == "supported", promoted
    passed.append("promote")

    inspected = json.loads(
        inspect_evidence.invoke({"finding_id": promoted["node_id"], "state": state}, config=config)
    )
    assert inspected.get("verification", {}).get("outcome") == "supported", inspected
    assert "validated" not in inspected["finding"]["props"]
    passed.append("kg-consumer")

    # A foreign/missing verification writes nothing.
    foreign = json.loads(
        record_workspace_finding.invoke(
            {"finding_id": "FIND-MISSING", "state": state}, config=config
        )
    )
    assert "error" in foreign, foreign
    passed.append("no-write")

    reread = json.loads(
        recheck_workspace_verification.invoke(
            {"finding_id": "FIND-A2", "state": state}, config=config
        )
    )
    assert reread["verification"]["outcome"] == "supported"
    passed.append("a1-recheck")

    remote.close()
    return passed


def main() -> None:
    assert os.environ.get("RAPTIX_WORKSPACE_ISOLATED") == "1"
    engagement = os.environ.get("RAPTIX_ENGAGEMENT", "")
    assert engagement.startswith("itest-"), "use a test engagement"
    assert os.environ.get("RAPTIX_NEO4J_URI"), "real Neo4j required"
    assert not any(Path(ROOT).iterdir()), "use a fresh test volume"
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
        state = {"kg_engagement": engagement, "workspace_path": ROOT}
        store = KGStore.from_env()
        try:
            passed = asyncio.run(exercise(config, state))
            print(json.dumps({"result": "PASS", "checks": passed}, sort_keys=True))
        finally:
            store.execute_write(
                "MATCH (n) WHERE n.engagement = $engagement DETACH DELETE n",
                engagement=engagement,
            )
            store.execute_write(
                "MATCH (n:KGRevision {scope: $engagement}) DELETE n",
                engagement=engagement,
            )
            store.close()
            server.should_exit = True
            thread.join(10)
            assert not thread.is_alive(), "test daemon did not stop"


if __name__ == "__main__":
    main()
