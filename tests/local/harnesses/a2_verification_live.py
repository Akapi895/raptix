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
from uuid import uuid4

import uvicorn
from langchain.agents import create_agent
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from raptix.execution.backends.factory import build_sandbox_backend
from raptix.execution.tools.evidence.tools import (
    inspect_evidence,
    recheck_workspace_verification,
    record_workspace_finding,
)
from raptix.execution.tools.plumbing.verification import validate_workspace_finding
from raptix.knowledge.graph.store import KGStore
from raptix.knowledge.graph.summary import build_summary
from raptix.middleware.filesystem import EngagementFilesystemBackend
from raptix.middleware.kg import KGMiddleware
from raptix_core.types.kg import Node, NodeKind

CVSS = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
ROOT = "/workspace"


def promote(finding_id: str, state: dict, config: dict) -> dict:
    message = record_workspace_finding.invoke(
        {
            "type": "tool_call",
            "name": "record_workspace_finding",
            "id": "a2-bridge-turn",
            "args": {"finding_id": finding_id, "state": state},
        },
        config=config,
    )
    return json.loads(message.content)


async def exercise(config: dict, state: dict) -> list[str]:
    remote = build_sandbox_backend(config)
    filesystem = EngagementFilesystemBackend(remote, ROOT)
    passed: list[str] = []

    producer_run = uuid4()
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
        config={**config, "run_id": producer_run},
    )
    path = f"{ROOT}/findings/evidence/FIND-A2_verification.json"
    assert not filesystem.write(path, raw).error
    assert json.loads(raw)["validated"] is True

    promoted = promote("FIND-A2", state, config)
    assert promoted["verification_outcome"] == "supported", promoted
    passed.append("promote")

    inspected = json.loads(
        inspect_evidence.invoke({"finding_id": promoted["node_id"], "state": state}, config=config)
    )
    assert inspected.get("verification", {}).get("outcome") == "supported", inspected
    assert "validated" not in inspected["finding"]["props"]
    assert inspected["finding"]["props"]["verification_invocation_id"] == str(producer_run)
    passed.append("kg-consumer")

    # A foreign/missing verification writes nothing.
    foreign = promote("FIND-MISSING", state, config)
    assert "error" in foreign, foreign
    passed.append("no-write")

    reread = json.loads(
        recheck_workspace_verification.invoke(
            {"finding_id": "FIND-A2", "state": state}, config=config
        )
    )
    assert reread["verification"]["outcome"] == "supported"
    passed.append("a1-recheck")

    # Change the JSON ID but keep the original reference: neither consumer may
    # accept this transplant, even if somebody writes that reference to the KG.
    copied = json.loads(raw)
    copied["vuln_id"] = "FIND-COPY"
    assert not filesystem.write(
        f"{ROOT}/findings/evidence/FIND-COPY_verification.json", json.dumps(copied)
    ).error
    assert "error" in promote("FIND-COPY", state, config)
    store = KGStore.from_env()
    engagement = state["kg_engagement"]
    other_engagement = engagement + "-foreign"
    try:
        attribution = store.execute_read(
            "MATCH (n:Finding {key: 'finding::FIND-A2', engagement: $engagement}) RETURN n.source_episode_id AS episode",
            engagement=engagement,
        )
        assert attribution[0]["episode"] == "a2-bridge-turn"
        records = [
            {
                "kind": "Finding",
                "key": "finding::FIND-COPY",
                "label": "copy",
                "props": {
                    "verification_ref": copied["verification_ref"],
                    "verification_outcome": "supported",
                },
            }
        ]
        store.record_observations(
            records, engagement=engagement, created_by="fixture", source_episode_id="copied-ref"
        )
        copied_node = Node.make(NodeKind.FINDING, "copy", key="finding::FIND-COPY")
        checked = json.loads(
            inspect_evidence.invoke({"finding_id": copied_node.id, "state": state}, config=config)
        )
        assert checked["verification"]["reason"] == "finding_binding_mismatch", checked
        passed.append("copied-binding-rejected")

        # Real Cypher fixture: aliases share one lineage, foreign graph props
        # and credentials are excluded, contradictory snapshots stay snapshots.
        store.record_observations(
            [
                {
                    "kind": "Finding",
                    "key": "finding::FOREIGN-ONLY",
                    "label": "foreign",
                    "props": {
                        "verification_ref": "workspace-evidence://" + "f" * 64,
                        "verification_outcome": "supported",
                    },
                }
            ],
            engagement=other_engagement,
            created_by="fixture",
            source_episode_id="foreign-turn",
        )
        store.record_observations(
            [
                {
                    "kind": "Finding",
                    "key": "finding::FIND-CONTRADICTED",
                    "label": "contradicted",
                    "props": {
                        "verification_ref": "workspace-evidence://" + "c" * 64,
                        "verification_outcome": "contradicted",
                        "password": "secret-must-not-appear",
                    },
                }
            ],
            engagement=engagement,
            created_by="fixture",
            source_episode_id="contradicted-turn",
        )
        os.environ.pop("RAPTIX_KG_EVIDENCE_CONTEXT", None)
        assert "UNTRUSTED_KG_EVIDENCE" not in build_summary(store, engagement=engagement)
        os.environ["RAPTIX_KG_EVIDENCE_CONTEXT"] = "1"
        context = build_summary(store, engagement=engagement)
        assert context.count(copied["verification_ref"]) == 1, context
        assert '"recorded_outcome": "contradicted"' in context
        assert "FOREIGN-ONLY" not in context and "secret-must-not-appear" not in context
        assert "not current verification" in context
        passed.append("context-scope-lineage-contradiction-flag")

        class CapturePrompt(BaseCallbackHandler):
            def __init__(self) -> None:
                self.prompts: list[str] = []

            def on_chat_model_start(self, serialized, messages, **kwargs) -> None:
                self.prompts.extend(
                    str(message.content)
                    for batch in messages
                    for message in batch
                    if message.type == "system"
                )

        capture = CapturePrompt()
        model = GenericFakeChatModel(
            messages=iter([AIMessage(content="provider fixture complete")])
        )
        agent = create_agent(
            model=model, middleware=[KGMiddleware(store=store, enabled_tools=set())]
        )
        await agent.ainvoke(
            {**state, "messages": [{"role": "user", "content": "Read engagement context."}]},
            config={"callbacks": [capture]},
        )
        assert any("UNTRUSTED_KG_EVIDENCE" in prompt for prompt in capture.prompts)
        passed.append("agent-middleware-injection")

        # Integrity loss must invalidate recheck, not the historical snapshot.
        from raptix.execution.tools.evidence.artifacts import resolve_verification

        record = resolve_verification(
            copied["verification_ref"], sandbox=remote, workspace=ROOT, engagement=engagement
        )
        digest = record["proof_ref"].rsplit("/", 1)[-1]
        remote.upload_files(
            [(f"{ROOT}/evidence/scanner-captures/{digest}.bin", b"drifted")], workspace_path=ROOT
        )
        drifted = json.loads(
            inspect_evidence.invoke(
                {"finding_id": promoted["node_id"], "state": state}, config=config
            )
        )
        assert drifted["verification"]["outcome"] == "inconclusive"
        assert "error" in promote("FIND-A2", state, config)
        assert "not current verification" in build_summary(store, engagement=engagement)
        passed.append("stale-capture-not-verified")

        store.record_observations(
            [
                {
                    "kind": "Finding",
                    "key": f"finding::CAP-{i}",
                    "label": f"cap-{i}",
                    "props": {
                        "verification_ref": "workspace-evidence://" + f"{i:064x}",
                        "verification_outcome": "inconclusive",
                    },
                }
                for i in range(8)
            ],
            engagement=engagement,
            created_by="fixture",
            source_episode_id="cap-turn",
        )
        bounded = build_summary(store, engagement=engagement)
        block = bounded[bounded.index("<UNTRUSTED_KG_EVIDENCE>") :]
        rows = [json.loads(line) for line in block.splitlines() if line.startswith("{")]
        assert len(block) <= 3200 and len(rows) == 5
        assert [row["finding_id"] for row in rows] == [f"CAP-{i}" for i in range(5)]
        passed.append("context-bound-stable-order")

        # Cut the recent window BEFORE dedup: twenty recent aliases must not
        # pull in an older independent reference merely to fill five rows.
        store.execute_write(
            "MATCH (n) WHERE n.engagement = $engagement SET n.lastupdated = 0",
            engagement=engagement,
        )
        store.record_observations(
            [
                {
                    "kind": "Finding",
                    "key": f"finding::WINDOW-{i:02}",
                    "label": "alias",
                    "props": {
                        "verification_ref": "workspace-evidence://" + "d" * 64,
                        "verification_outcome": "supported",
                    },
                }
                for i in range(22)
            ],
            engagement=engagement,
            created_by="fixture",
            source_episode_id="window-turn",
        )
        store.execute_write(
            "MATCH (n:Finding) WHERE n.engagement = $engagement AND n.key STARTS WITH 'finding::WINDOW-' "
            "SET n.lastupdated = 100 + toInteger(right(n.key, 2))",
            engagement=engagement,
        )
        window = build_summary(store, engagement=engagement)
        rows = [json.loads(line) for line in window.splitlines() if line.startswith("{")]
        assert len(rows) == 1 and rows[0]["finding_id"] == "WINDOW-21", rows
        passed.append("recent-window-before-lineage-dedup")
    finally:
        store.delete_engagement(engagement=other_engagement)
        store.execute_write(
            "MATCH (n:KGRevision {scope: $engagement}) DELETE n", engagement=other_engagement
        )
        store.close()

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
