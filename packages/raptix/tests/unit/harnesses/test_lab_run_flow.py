"""Harness entry point and turn loop with real files and bounded API stand-ins."""

from __future__ import annotations

import json
import subprocess
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from tests.unit.harnesses.test_image_provenance import HEAD, lab_run


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, format: str, *args: Any) -> None:
        return


@pytest.fixture
def harness(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import langgraph_sdk

    server = ThreadingHTTPServer(("127.0.0.1", 0), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    prompt, proceed = tmp_path / "prompt.txt", tmp_path / "proceed.txt"
    prompt.write_text("Review canary", encoding="utf-8")
    proceed.write_text("continue", encoding="utf-8")
    argv = [
        "--engagement",
        "lab-review",
        "--container-workspace",
        "/workspace",
        "--target",
        "authorized.invalid",
        "--prompt-file",
        str(prompt),
        "--proceed-file",
        str(proceed),
        "--out-dir",
        str(tmp_path),
        "--langgraph-url",
        f"http://127.0.0.1:{server.server_port}",
        "--max-turns",
        "3",
        "--snapshot-interval",
        "9999",
        "--log-containers",
        "missing-review-container",
    ]

    class API:
        inputs: list[dict]

        def __init__(self) -> None:
            self.inputs = []

        async def create(self, *args, **kwargs):
            if "input" in kwargs:
                self.inputs.append(kwargs["input"])
            return {"run_id": f"run-{len(self.inputs)}"}

        async def get(self, *args):
            return {"status": "success"}

        async def get_state(self, *args):
            return {
                "values": {
                    "messages": [
                        {"type": "ai", "id": f"msg-{len(self.inputs)}", "content": "canary"}
                    ],
                    "objectives": [{"status": "pending"}],
                }
            }

        async def list(self, *args):
            return []

    api = API()
    monkeypatch.setattr(
        langgraph_sdk, "get_client", lambda **kwargs: SimpleNamespace(threads=api, runs=api)
    )
    stack = {
        "Mounts": [
            {"Type": "bind", "Destination": "/workspace", "Source": "/host/workspace/lab-review"}
        ],
        "Config": {"Env": ["RAPTIX_ENGAGEMENT=lab-review", "RAPTIX_WORKSPACE_ISOLATED=1"]},
    }

    def transport(command, **kwargs):
        if command[:3] == ["git", "rev-parse", "HEAD"]:
            return subprocess.CompletedProcess(command, 0, HEAD, "")
        if command[:3] == ["git", "status", "--short"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        if command[:2] == ["docker", "inspect"]:
            stdout = (
                HEAD if "org.opencontainers.image.revision" in command[-1] else json.dumps(stack)
            )
            return subprocess.CompletedProcess(command, 0, stdout, "")
        if command[:2] == ["docker", "logs"]:
            return subprocess.CompletedProcess(command, 1, "", "Error: No such container")
        if command[:2] in (["docker", "exec"], ["docker", "cp"]):
            return subprocess.CompletedProcess(
                command, 0, '{"path":"/workspace","created":false}', ""
            )
        raise AssertionError(f"Unexpected external command: {command}")

    monkeypatch.setattr(subprocess, "run", transport)
    args = lab_run._parse_args(argv)
    args.protocol_records = lab_run._merge_protocol([], "continue")
    try:
        yield SimpleNamespace(args=args, argv=argv, api=api, stack=stack, root=tmp_path)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_new_output_directory_reaches_preflight(harness) -> None:
    argv = [*harness.argv, "--langgraph-url", "http://127.0.0.1:1"]
    with pytest.raises(SystemExit, match="LangGraph API unreachable"):
        lab_run.main(argv)
    manifest_path = next(harness.root.glob("*_lab-review/manifest.json"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["api_reachable"] is False


async def test_turn_one_injection_starts_second_run(harness) -> None:
    harness.args.protocol_records = lab_run._merge_protocol(
        [{"turn": 1, "kind": "hint", "text": "turn-one canary", "source": "review"}], "continue"
    )
    await lab_run._amain(harness.args, harness.root / "run", {})
    assert harness.api.inputs[1]["messages"][0]["content"] == "turn-one canary"


async def test_unreached_hint_is_not_counted_as_delivered(harness) -> None:
    harness.args.protocol_records = lab_run._merge_protocol(
        [{"turn": 99, "kind": "hint", "text": "unreached", "source": "review"}], "continue"
    )
    summary = await lab_run._amain(harness.args, harness.root / "run", {})
    assert summary["injections"]["hint"] == 0


async def test_failed_log_command_marks_capture_failed(harness) -> None:
    summary = await lab_run._amain(harness.args, harness.root / "run", {})
    assert summary["capture_channels"]["container_logs"].startswith("failed: 0/1")


async def test_fresh_kg_failure_prevents_thread_execution(harness, monkeypatch) -> None:
    harness.args.fresh_kg = True
    for name in ("RAPTIX_NEO4J_URI", "RAPTIX_NEO4J_USER", "RAPTIX_NEO4J_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(RuntimeError, match="KG reset failed"):
        await lab_run._amain(harness.args, harness.root / "run", {})
    assert harness.api.inputs == []


def test_archived_protocol_contains_merged_standing_approval(harness, monkeypatch) -> None:
    instant = datetime(2026, 10, 7, tzinfo=UTC)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant

    monkeypatch.setattr(lab_run, "datetime", Clock)
    protocol = harness.root / "source-protocol.jsonl"
    protocol.write_text(
        json.dumps({"turn": 0, "kind": "hint", "text": "hint canary"}) + "\n", encoding="utf-8"
    )
    lab_run.main([*harness.argv, "--protocol-file", str(protocol)])
    output = harness.root / "20261007T000000Z_lab-review"
    archived = [
        json.loads(line)
        for line in (output / "input/protocol.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
    assert {
        "standing": [r["text"] for r in archived if r["turn"] == -1],
        "delivered": summary["injections"],
    } == {"standing": ["continue"], "delivered": {"hint": 1, "interference": 0, "proceed": 2}}


def test_protocol_can_be_the_only_standing_approval_source(harness) -> None:
    protocol = harness.root / "protocol.jsonl"
    protocol.write_text(
        '{"turn":-1,"kind":"proceed","text":"protocol approval"}\n', encoding="utf-8"
    )
    argv = harness.argv.copy()
    index = argv.index("--proceed-file")
    del argv[index : index + 2]
    lab_run.main([*argv, "--protocol-file", str(protocol)])
    assert harness.api.inputs[1]["messages"][0]["content"] == "protocol approval"


@pytest.mark.parametrize(
    ("mount_type", "source"),
    [("bind", "/host/workspace"), ("volume", "/host/workspace/lab-review")],
)
async def test_non_isolated_mount_is_refused_even_with_allow_dirty(
    harness, mount_type: str, source: str
) -> None:
    harness.args.allow_dirty = True
    harness.stack["Mounts"][0].update({"Type": mount_type, "Source": source})
    with pytest.raises(SystemExit, match="isolated engagement workspace"):
        await lab_run._amain(harness.args, harness.root / "run", {})
    assert harness.api.inputs == []
