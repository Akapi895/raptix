"""Scanner capture retention and source inspection through public seams."""

from __future__ import annotations

import json

import httpx
import pytest

from raptix.execution.backends.http_sandbox import HTTPSandbox
from raptix_core.types.capability import Artifact
from raptix_core.types.kg import Node, NodeKind


class MemoryTransport:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.commands: dict[str, str] = {}

    def handle(self, request: httpx.Request) -> httpx.Response:
        import base64

        body = json.loads(request.content)
        scope = body.get("workspace_path")
        if request.url.path == "/execute_tmux":
            return httpx.Response(
                200, json={"output": self.commands.get(body.get("command"), "[Exit code: 1]")}
            )
        if request.url.path == "/upload_files":
            for item in body["files"]:
                self.files[item["path"]] = base64.b64decode(item["data_b64"])
            return httpx.Response(
                200, json={"files": [{"path": f["path"]} for f in body["files"]], "scope": scope}
            )
        if request.url.path == "/download_files":
            return httpx.Response(
                200,
                json={
                    "scope": scope,
                    "files": [
                        {"path": path, "data_b64": base64.b64encode(self.files[path]).decode()}
                        if path in self.files
                        else {"path": path, "error": "file_not_found"}
                        for path in body["paths"]
                    ],
                },
            )
        raise AssertionError(f"unexpected endpoint {request.url.path}")


def sandbox(transport: MemoryTransport, endpoint: str = "http://engagement-a") -> HTTPSandbox:
    result = HTTPSandbox(base_url=endpoint)
    result._client = httpx.Client(
        base_url=endpoint, transport=httpx.MockTransport(transport.handle)
    )
    return result


def test_retained_source_survives_original_file_overwrite() -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source, retain_artifact

    transport = MemoryTransport()
    remote = sandbox(transport)
    original = "/workspace/acme/scan.txt"
    transport.files[original] = b"api.acme.test\n"
    artifact = Artifact(id="scan-1", artifact_ref="episode://scan-1", format_hint="subfinder")
    retained = retain_artifact(
        artifact,
        transport.files[original],
        sandbox=remote,
        workspace="/workspace/acme",
        engagement="acme",
        parser_id="subfinder",
        parser_version="1.0.0",
    )
    transport.files[original] = b"other.acme.test\n"
    node = Node.make(
        NodeKind.HOST,
        "api.acme.test",
        key="host::api.acme.test",
        source_artifact_id="scan-1",
        source_artifact_ref=retained.artifact_ref,
        parser_id="subfinder",
    )
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement="acme"
    )
    assert result["integrity"] == "ok"
    assert result["assessment"]["outcome"] == "supported"
    assert result["assessment"]["scope"] == "scanner_output_membership"


def test_http_download_distinguishes_empty_from_missing() -> None:
    transport = MemoryTransport()
    transport.files["/workspace/empty.bin"] = b""
    remote = sandbox(transport)
    empty, missing = remote.download_files(["/workspace/empty.bin", "/workspace/missing.bin"])
    assert empty.content == b""
    assert missing.content is None
    assert missing.error == "file_not_found"


def test_scoped_download_fails_closed_with_old_server() -> None:
    from raptix.execution.backends.http_sandbox import SandboxError

    remote = HTTPSandbox(base_url="http://old-server")
    remote._client = httpx.Client(
        base_url="http://old-server",
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"files": []})),
    )
    with pytest.raises(SandboxError, match="acknowledge"):
        remote.download_files(["/workspace/a.txt"], workspace_path="/workspace", max_bytes=10)


def test_server_rejects_download_outside_requested_workspace(monkeypatch, tmp_path) -> None:
    """The scoped-download route refuses a path outside the requested workspace.

    The engagement pin and auth token are pinned so the assertion does not
    depend on env another test may leave in the daemon process.
    """
    from importlib import import_module

    from fastapi.testclient import TestClient

    from raptix.execution.sandbox.kernel.daemon import DaemonSandbox

    server = import_module("raptix.execution.sandbox.server.app")
    monkeypatch.setattr(server, "_fenced_engagement_slug", lambda: None)
    monkeypatch.setattr(server, "_required_token", None)
    monkeypatch.setattr(server, "_get_backend", lambda: object.__new__(DaemonSandbox))
    root = tmp_path / "active"
    root.mkdir()
    outside = tmp_path / "foreign.bin"
    outside.write_bytes(b"foreign evidence")
    response = TestClient(server.app).post(
        "/download_files",
        json={"paths": [str(outside)], "workspace_path": str(root), "max_bytes": 100},
    )
    assert response.status_code == 403


@pytest.fixture
def retained_source():
    from raptix.execution.tools.evidence.artifacts import retain_artifact

    transport = MemoryTransport()
    remote = sandbox(transport)
    artifact = retain_artifact(
        Artifact(id="source-1", artifact_ref="episode://source-1", format_hint="subfinder"),
        b"api.acme.test\n",
        sandbox=remote,
        workspace="/workspace/acme",
        engagement="acme",
        parser_id="subfinder",
        parser_version="1.0.0",
    )
    node = Node.make(
        NodeKind.HOST,
        "api.acme.test",
        key="host::api.acme.test",
        source_artifact_id=artifact.id,
        source_artifact_ref=artifact.artifact_ref,
        parser_id="subfinder",
    )
    return transport, remote, node


@pytest.mark.parametrize("mutation,integrity", [("remove", "missing"), ("change", "drift")])
def test_capture_loss_or_drift_is_inconclusive(retained_source, mutation, integrity) -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source

    transport, remote, node = retained_source
    path = next(path for path in transport.files if path.endswith(".bin"))
    if mutation == "remove":
        transport.files.pop(path)
    else:
        transport.files[path] = b"replacement\n"
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement="acme"
    )
    assert result["integrity"] == integrity
    assert result["assessment"]["outcome"] == "inconclusive"


def test_valid_capture_without_recorded_identity_contradicts_only_source_membership(
    retained_source,
) -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source

    _, remote, node = retained_source
    node.props["key"] = "host::not-in-capture.acme.test"
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement="acme"
    )
    assert result["integrity"] == "ok"
    assert result["assessment"]["outcome"] == "contradicted"
    assert result["assessment"]["scope"] == "scanner_output_membership"
    assert "validated" not in node.props


@pytest.mark.parametrize(
    "engagement,source_id,parser_id",
    [
        ("foreign", "source-1", "subfinder"),
        ("acme", "other-source", "subfinder"),
        ("acme", "source-1", "other-parser"),
    ],
)
def test_capture_context_mismatch_cannot_support_claim(
    retained_source, engagement, source_id, parser_id
) -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source

    _, remote, node = retained_source
    node.props.update(source_artifact_id=source_id, parser_id=parser_id)
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement=engagement
    )
    assert result["assessment"]["outcome"] == "inconclusive"
    assert result["assessment"]["reason"] == "scope_or_artifact_mismatch"


def test_descriptor_drift_is_detected_before_parsing(retained_source) -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source

    transport, remote, node = retained_source
    path = next(path for path in transport.files if path.endswith(".json"))
    transport.files[path] += b" "
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement="acme"
    )
    assert result["integrity"] == "drift"
    assert result["assessment"]["outcome"] == "inconclusive"


@pytest.mark.parametrize("content", [b"", b"\x00\xff\x80\n"])
def test_capture_retains_exact_empty_and_binary_bytes(content) -> None:
    from raptix.execution.tools.evidence.artifacts import retain_artifact

    transport = MemoryTransport()
    retain_artifact(
        Artifact(id="binary", artifact_ref="episode://binary", format_hint="subfinder"),
        content,
        sandbox=sandbox(transport),
        workspace="/workspace/acme",
        engagement="acme",
        parser_id="subfinder",
        parser_version="1.0.0",
    )
    assert (
        next(value for path, value in transport.files.items() if path.endswith(".bin")) == content
    )


def test_identical_bytes_in_distinct_executions_keep_distinct_references() -> None:
    from raptix.execution.tools.evidence.artifacts import retain_artifact

    remote = sandbox(MemoryTransport())
    first, second = [
        retain_artifact(
            Artifact(id=episode, artifact_ref=f"episode://{episode}", format_hint="subfinder"),
            b"api.acme.test\n",
            sandbox=remote,
            workspace="/workspace/acme",
            engagement="acme",
            parser_id="subfinder",
            parser_version="1.0.0",
        )
        for episode in ("run-1", "run-2")
    ]
    assert first.sha256 == second.sha256
    assert first.artifact_ref != second.artifact_ref


def test_changed_parser_version_is_not_reinterpreted_as_verified_source() -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source, retain_artifact

    remote = sandbox(MemoryTransport())
    artifact = retain_artifact(
        Artifact(id="old-parser", artifact_ref="episode://old-parser", format_hint="subfinder"),
        b"api.acme.test\n",
        sandbox=remote,
        workspace="/workspace/acme",
        engagement="acme",
        parser_id="subfinder",
        parser_version="0.0.0",
    )
    node = Node.make(
        NodeKind.HOST,
        "api.acme.test",
        key="host::api.acme.test",
        source_artifact_id=artifact.id,
        source_artifact_ref=artifact.artifact_ref,
        parser_id="subfinder",
    )
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement="acme"
    )
    assert result["integrity"] == "ok"
    assert result["assessment"]["outcome"] == "inconclusive"
    assert result["assessment"]["reason"] == "parser_version_unavailable"


def test_unknown_reference_never_becomes_a_filesystem_path(retained_source) -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source

    _, remote, node = retained_source
    node.props["source_artifact_ref"] = "file:///etc/passwd"
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement="acme"
    )
    assert result["assessment"]["outcome"] == "inconclusive"
    assert result["assessment"]["reason"] == "invalid_reference_or_workspace"


async def test_autoingest_retains_source_for_existing_evidence_consumer(monkeypatch) -> None:
    from types import SimpleNamespace

    from langchain_core.messages import ToolMessage

    from raptix.execution.tools.evidence.tools import inspect_evidence
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware
    from raptix_core.types.kg import KnowledgeGraph
    from raptix_core.utils.engagement_scope import reset_active_engagement, set_active_engagement

    transport = MemoryTransport()
    transport.files["/workspace/acme/subs.txt"] = b"api.acme.test\n"
    config = {"configurable": {"sandbox_url": "http://traceability-acme"}}
    from raptix.execution.backends.factory import build_sandbox_backend

    remote = build_sandbox_backend(config)
    remote._client = httpx.Client(
        base_url="http://traceability-acme", transport=httpx.MockTransport(transport.handle)
    )
    monkeypatch.setattr(
        remote,
        "ls_info",
        lambda _: [
            {
                "path": "/workspace/acme/subs.txt",
                "size": len(transport.files["/workspace/acme/subs.txt"]),
            }
        ],
    )
    graph = KnowledgeGraph()

    class Store:
        def record_observations(self, records, **scope):
            for record in records:
                graph.upsert_node(
                    Node.make(
                        NodeKind(record["kind"]),
                        record["label"],
                        key=record["key"],
                        **record["props"],
                    )
                )

    monkeypatch.setenv("RAPTIX_KG_AUTOINGEST", "1")
    monkeypatch.setenv("RAPTIX_KG_EVIDENCE_CAPTURE", "1")
    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        runtime=SimpleNamespace(config=config),
        state={"engagement_name": "acme", "workspace_path": "/workspace/acme"},
        tool_call={
            "id": "scan-source-1",
            "args": {"command": "subfinder -d acme.test -o /workspace/acme/subs.txt"},
        },
    )
    original = ToolMessage(content="scan done\n[Exit code: 0]", tool_call_id="scan-source-1")

    async def handler(_):
        return original

    returned = await KGAutoIngestMiddleware(
        store=Store(), sandbox=remote, role="recon"
    ).awrap_tool_call(request, handler)
    assert returned is original
    node = next(node for node in graph.nodes.values() if node.kind == NodeKind.HOST)
    assert node.props["source_artifact_ref"].startswith("workspace-evidence://")
    monkeypatch.setattr(
        "raptix.execution.tools.reporting.kg_adapter.load_engagement_graph", lambda _: graph
    )
    token = set_active_engagement("acme")
    try:
        result = json.loads(
            inspect_evidence.invoke({"finding_id": node.id, "state": request.state}, config=config)
        )
    finally:
        reset_active_engagement(token)
    assert result["captured_source"]["assessment"]["outcome"] == "supported"


def _inspect(monkeypatch, node, config, state):
    from raptix.execution.tools.evidence.tools import inspect_evidence
    from raptix_core.types.kg import KnowledgeGraph
    from raptix_core.utils.engagement_scope import reset_active_engagement, set_active_engagement

    graph = KnowledgeGraph()
    graph.upsert_node(node)
    monkeypatch.setattr(
        "raptix.execution.tools.reporting.kg_adapter.load_engagement_graph", lambda _: graph
    )
    token = set_active_engagement("acme")
    try:
        return json.loads(
            inspect_evidence.invoke({"finding_id": node.id, "state": state}, config=config)
        )
    finally:
        reset_active_engagement(token)


def test_ambient_sandbox_url_is_not_used_for_capture(retained_source, monkeypatch) -> None:
    """No explicit run-config URL means missing_run_context, never the process-wide daemon."""
    _, remote, node = retained_source
    monkeypatch.setenv("SANDBOX_URL", "http://ambient-must-not-be-used")

    def _forbidden(_config):
        raise AssertionError("ambient sandbox must not be resolved")

    monkeypatch.setattr("raptix.execution.backends.factory.build_sandbox_backend", _forbidden)
    result = _inspect(
        monkeypatch, node, {}, {"kg_engagement": "acme", "workspace_path": "/workspace/acme"}
    )
    assert result["captured_source"]["assessment"]["reason"] == "missing_run_context"


def test_capture_uses_state_partition_not_configurable_slug(retained_source, monkeypatch) -> None:
    """The descriptor's engagement must match the producer (kg_engagement), not a
    differing run-config slug, or every capture would read as scope mismatch."""
    _, remote, node = retained_source
    monkeypatch.setattr(
        "raptix.execution.backends.factory.build_sandbox_backend", lambda _config: remote
    )
    config = {
        "configurable": {
            "sandbox_url": "http://traceability-acme",
            "workspace_path": "/workspace/acme",
            "engagement_name": "different-slug",
        }
    }
    result = _inspect(
        monkeypatch, node, config, {"kg_engagement": "acme", "workspace_path": "/workspace/acme"}
    )
    assert result["captured_source"]["assessment"]["outcome"] == "supported"


_NMAP_XML = (
    b'<nmaprun><host><status state="up"/>'
    b'<address addr="10.0.0.1" addrtype="ipv4"/>'
    b'<ports><port portid="80" protocol="tcp"><state state="open"/>'
    b'<service name="http"/></port></ports></host></nmaprun>'
)


class _GraphStore:
    """Minimal store that materializes observations into an in-memory graph."""

    def __init__(self) -> None:
        from raptix_core.types.kg import KnowledgeGraph

        self.graph = KnowledgeGraph()

    def record_observations(self, records, **scope):
        for record in records:
            self.graph.upsert_node(
                Node.make(
                    NodeKind(record["kind"]),
                    record["label"],
                    key=record["key"],
                    **record.get("props", {}),
                )
            )
        return {"created": len(records), "merged": 0, "edges": 0, "revision": "r"}


def _legacy_scan(monkeypatch):
    """Run the legacy nmap auto-ingest path over the memory transport."""
    from types import SimpleNamespace

    from langchain_core.messages import ToolMessage

    from raptix.execution.backends.factory import build_sandbox_backend

    transport = MemoryTransport()
    transport.files["/workspace/acme/scan.xml"] = _NMAP_XML
    config = {"configurable": {"sandbox_url": "http://traceability-acme"}}
    remote = build_sandbox_backend(config)
    remote._client = httpx.Client(
        base_url="http://traceability-acme", transport=httpx.MockTransport(transport.handle)
    )
    monkeypatch.setattr(
        remote, "ls_info", lambda _: [{"path": "/workspace/acme/scan.xml", "size": len(_NMAP_XML)}]
    )
    monkeypatch.setenv("RAPTIX_KG_AUTOINGEST", "1")
    monkeypatch.setenv("RAPTIX_KG_EVIDENCE_CAPTURE", "1")
    request = SimpleNamespace(
        tool=SimpleNamespace(name="bash"),
        runtime=SimpleNamespace(config=config),
        state={"engagement_name": "acme", "workspace_path": "/workspace/acme"},
        tool_call={
            "id": "legacy-scan-1",
            "args": {"command": "nmap -oX /workspace/acme/scan.xml 10.0.0.1"},
        },
    )
    reply = ToolMessage(content="scan done\n[Exit code: 0]", tool_call_id="legacy-scan-1")

    async def handler(_):
        return reply

    return transport, remote, _GraphStore(), request, reply, handler


async def test_legacy_scanner_capture_is_inspectable_after_overwrite(monkeypatch) -> None:
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source
    from raptix.middleware.kg_autoingest import KGAutoIngestMiddleware

    transport, remote, store, request, reply, handler = _legacy_scan(monkeypatch)
    returned = await KGAutoIngestMiddleware(
        store=store, sandbox=remote, role="recon"
    ).awrap_tool_call(request, handler)
    assert returned is reply
    node = next(node for node in store.graph.nodes.values() if node.kind == NodeKind.HOST)
    assert node.props["source_artifact_ref"].startswith("workspace-evidence://")

    # The original scan file is later overwritten; the capture must survive.
    transport.files["/workspace/acme/scan.xml"] = b"<nmaprun/>"
    result = inspect_artifact_source(
        node, sandbox=remote, workspace="/workspace/acme", engagement="acme"
    )
    assert result["integrity"] == "ok"
    assert result["size"] == len(_NMAP_XML)
    assert result["assessment"]["outcome"] == "not_assessed"
    assert result["assessment"]["scope"] == "capture_retention"


def _pair(remote, proof: bytes, control: bytes):
    from raptix.execution.tools.evidence.artifacts import retain_capture, verify_capture_pair

    proof_ref = retain_capture(
        proof, sandbox=remote, workspace="/workspace/acme", engagement="acme", producer="t"
    )
    control_ref = retain_capture(
        control, sandbox=remote, workspace="/workspace/acme", engagement="acme", producer="t"
    )
    return verify_capture_pair(
        proof_ref=proof_ref,
        control_ref=control_ref,
        success_patterns=["PROOF-MARKER"],
        negative_patterns=["baseline-ok"],
        sandbox=remote,
        workspace="/workspace/acme",
        engagement="acme",
    )


def test_verify_capture_pair_maps_the_differential_outcome() -> None:
    remote = sandbox(MemoryTransport())
    supported = _pair(remote, b"PROOF-MARKER body", b"baseline-ok body")
    assert supported["outcome"] == "supported"
    assert supported["integrity"] == {"proof": "ok", "control": "ok"}

    contradicted = _pair(remote, b"PROOF-MARKER body", b"baseline-ok PROOF-MARKER leak")
    assert contradicted["outcome"] == "contradicted"
    assert contradicted["noise_matches"] == ["PROOF-MARKER"]

    assert _pair(remote, b"nothing here", b"baseline-ok body")["outcome"] == "inconclusive"


def test_verify_capture_pair_is_inconclusive_when_a_capture_is_missing() -> None:
    from raptix.execution.tools.evidence.artifacts import verify_capture_pair

    result = verify_capture_pair(
        proof_ref="workspace-evidence://" + "0" * 64,
        control_ref="workspace-evidence://" + "1" * 64,
        success_patterns=["x"],
        negative_patterns=["y"],
        sandbox=sandbox(MemoryTransport()),
        workspace="/workspace/acme",
        engagement="acme",
    )
    assert result["outcome"] == "inconclusive"
    assert result["reason"] == "capture_unavailable"
    assert result["integrity"] == {"proof": "missing", "control": "missing"}


_CVSS = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"


async def test_workspace_finding_retains_pair_that_inspect_reports(monkeypatch) -> None:
    from raptix.execution.tools.evidence.tools import inspect_evidence
    from raptix.execution.tools.plumbing import verification as verify_module
    from raptix_core.types.kg import KnowledgeGraph

    transport = MemoryTransport()
    transport.commands["positive"] = "proof-marker found\n[Exit code: 0]"
    transport.commands["negative"] = "ordinary response\n[Exit code: 0]"
    remote = sandbox(transport)
    monkeypatch.setattr(verify_module, "get_sandbox", lambda: remote)
    monkeypatch.setenv("RAPTIX_KG_EVIDENCE_CAPTURE", "1")
    raw = await verify_module.validate_workspace_finding.ainvoke(
        {
            "finding_id": "FIND-001",
            "poc_command": "positive",
            "success_patterns": "proof-marker",
            "negative_command": "negative",
            "negative_patterns": "ordinary response",
            "cvss_vector": _CVSS,
            "state": {"kg_engagement": "acme", "workspace_path": "/workspace/acme"},
        }
    )
    produced = json.loads(raw)
    ref = produced["verification_ref"]
    assert ref.startswith("workspace-evidence://")

    node = Node.make(
        NodeKind.FINDING, "validated: differential", key="finding::x", verification_ref=ref
    )
    graph = KnowledgeGraph()
    graph.upsert_node(node)
    monkeypatch.setattr(
        "raptix.execution.tools.reporting.kg_adapter.load_engagement_graph", lambda _: graph
    )
    monkeypatch.setattr(
        "raptix.execution.backends.factory.build_sandbox_backend", lambda _config: remote
    )
    config = {
        "configurable": {
            "sandbox_url": "http://traceability-acme",
            "workspace_path": "/workspace/acme",
        }
    }
    result = json.loads(
        inspect_evidence.invoke(
            {
                "finding_id": node.id,
                "state": {"kg_engagement": "acme", "workspace_path": "/workspace/acme"},
            },
            config=config,
        )
    )
    assert result["verification"]["outcome"] == "supported"
    assert "validated" not in node.props
