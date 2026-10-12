"""Evidence tools: capture/seal explicitly, inspect automatically.

Wave T5 originally planned to make sealing/verification/recording
automatic "in the ArtifactStore pipeline" and drop them from the agent
surface entirely. A review caught that this pipeline doesn't exist yet —
removing ``@tool`` from ``seal_evidence``/``export_session_asciicast``/
``list_session_recordings`` with no automatic replacement left them with
no caller at all, so the manifest `seal_evidence` writes never gets
created and `inspect_evidence`'s `custody`/`recordings` fields would
always report empty (the exact T3-shaped regression: a decorator removed
with nothing left to invoke it). Fixed the same way T3's holdouts were:
these 3 keep their ``@tool`` decorator and ``EVIDENCE_TOOLS`` membership
until a real automatic pipeline lands to replace them — ``verify_evidence``
stays a plain function since it IS reachable today, via
``inspect_evidence``'s ``_verify_manifest`` call.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.prebuilt import InjectedState

from raptix.execution.tools.evidence.asciicast import (
    AsciicastExportError,
    export_asciicast,
    list_recordings,
)
from raptix.middleware._audit_sink import (
    _GENESIS_PREV_HASH,
    _record_hash,
    _record_hmac,
)

_MANIFEST_NAME = "chain-of-custody.jsonl"
_SEAL_FIELDS = ("path", "sha256", "size", "sealed_at")


def _json(data: Any) -> str:
    return json.dumps(data, indent=2, default=str, ensure_ascii=False)


def _workspace() -> Path:
    return Path(os.environ.get("RAPTIX_ENGAGEMENT_WORKSPACE") or "/workspace")


def _evidence_dir() -> Path:
    return _workspace() / "evidence" / "recordings"


def _evidence_root(workspace_path: str) -> Path:
    base = Path(workspace_path) if workspace_path else _workspace()
    return base / "evidence"


def _hmac_key() -> bytes | None:
    env_key = os.environ.get("RAPTIX_AUDIT_HMAC_KEY")
    return env_key.encode("utf-8") if env_key else None


def _hmac_equal(expected: str, stored: Any) -> bool:
    return hmac.compare_digest(expected, str(stored or ""))


def _hash_file(file_path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with file_path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _evidence_files(evidence_root: Path, manifest_path: Path) -> list[Path]:
    found: list[Path] = []
    for candidate in sorted(evidence_root.rglob("*")):
        if candidate.is_file() and candidate != manifest_path:
            found.append(candidate)
    return found


@tool
def export_session_asciicast(
    session_name: str,
    pipe_pane_log_path: str = "",
    title: str = "",
) -> str:
    """Convert a tmux session's pipe-pane log into an asciicast v2 (.cast) file.

    Produces ``<workspace>/evidence/recordings/<session_name>.cast`` plus a
    ``.cast.manifest.json`` sidecar. The asciicast file can be played back
    in any browser with asciinema-player and bundled into the engagement
    out-brief for client visibility into agent actions.
    """
    log_path = (
        Path(pipe_pane_log_path)
        if pipe_pane_log_path
        else _workspace() / ".tmux-logs" / f"{session_name}.log"
    )
    out_dir = _evidence_dir()
    out_path = out_dir / f"{session_name}.cast"
    try:
        manifest = export_asciicast(
            log_path=log_path,
            output_path=out_path,
            session_name=session_name,
            title=title,
        )
    except AsciicastExportError as exc:
        return _json({"error": str(exc)})
    return _json({"status": "exported", **manifest})


@tool
def list_session_recordings() -> str:
    """List all asciicast recordings captured for the current engagement."""
    manifests = list_recordings(_evidence_dir())
    return _json({"count": len(manifests), "recordings": manifests})


@tool
def seal_evidence(workspace_path: str = "") -> str:
    """Seal every file under ``<workspace>/evidence/`` into the
    append-only chain-of-custody manifest (SHA-256 + size per file,
    one HMAC-chained record each)."""
    evidence_root = _evidence_root(workspace_path)
    if not evidence_root.is_dir():
        return _json({"error": f"evidence directory not found: {evidence_root}"})
    manifest_path = evidence_root / _MANIFEST_NAME
    files = _evidence_files(evidence_root, manifest_path)
    key = _hmac_key()
    sealed_at = datetime.now(timezone.utc).isoformat()
    prev_hash = _GENESIS_PREV_HASH
    if manifest_path.exists():
        with manifest_path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line:
                    continue
                try:
                    prev_hash = str(json.loads(line).get("hash", prev_hash))
                except json.JSONDecodeError:
                    continue
    records: list[dict[str, Any]] = []
    with manifest_path.open("a", encoding="utf-8") as fh:
        for file_path in files:
            sha256, size = _hash_file(file_path)
            rel = file_path.relative_to(evidence_root).as_posix()
            record: dict[str, Any] = {
                "path": rel,
                "sha256": sha256,
                "size": size,
                "sealed_at": sealed_at,
            }
            this_hash = _record_hash(record, prev_hash)
            record["prev_hash"] = prev_hash
            record["hash"] = this_hash
            record["hmac"] = _record_hmac(this_hash, key)
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            records.append(record)
            prev_hash = this_hash
    return _json(
        {
            "status": "sealed",
            "manifest": str(manifest_path),
            "sealed": len(records),
            "files": [r["path"] for r in records],
        }
    )


def _verify_manifest(evidence_root: Path) -> dict[str, Any]:
    """Re-hash + re-chain every record in the custody manifest.

    Shared by ``verify_evidence`` (internal service) and
    ``inspect_evidence`` (agent-facing projection).
    """
    manifest_path = evidence_root / _MANIFEST_NAME
    if not manifest_path.exists():
        return {"error": f"manifest not found: {manifest_path}"}
    key = _hmac_key()
    prev_hash = _GENESIS_PREV_HASH
    checked = 0
    drift: list[dict[str, Any]] = []
    missing: list[str] = []
    chain_errors: list[dict[str, Any]] = []
    with manifest_path.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                chain_errors.append({"reason": "undecodable record", "line": checked + 1})
                continue
            checked += 1
            core = {k: rec.get(k) for k in _SEAL_FIELDS}
            recomputed = _record_hash(core, prev_hash)
            if rec.get("prev_hash") != prev_hash or rec.get("hash") != recomputed:
                chain_errors.append({"path": rec.get("path"), "reason": "broken chain link"})
            elif key is not None and not _hmac_equal(
                _record_hmac(recomputed, key), rec.get("hmac")
            ):
                chain_errors.append({"path": rec.get("path"), "reason": "hmac mismatch"})
            prev_hash = str(rec.get("hash", prev_hash))
            file_path = evidence_root / str(rec.get("path", ""))
            if not file_path.is_file():
                missing.append(str(rec.get("path")))
                continue
            sha256, size = _hash_file(file_path)
            if sha256 != rec.get("sha256") or size != rec.get("size"):
                drift.append(
                    {
                        "path": rec.get("path"),
                        "expected_sha256": rec.get("sha256"),
                        "actual_sha256": sha256,
                        "expected_size": rec.get("size"),
                        "actual_size": size,
                    }
                )
    return {
        "manifest": str(manifest_path),
        "ok": not drift and not missing and not chain_errors,
        "records_checked": checked,
        "drift": drift,
        "missing": missing,
        "chain_errors": chain_errors,
    }


def verify_evidence(workspace_path: str = "") -> str:
    """Verify the evidence chain-of-custody manifest (drift, missing
    files, broken chain links)."""
    return _json(_verify_manifest(_evidence_root(workspace_path)))


@tool
def inspect_evidence(
    finding_id: str,
    config: RunnableConfig,
    state: Annotated[dict | None, InjectedState] = None,
) -> str:
    """Inspect the evidence trail for one finding.

    Verifier/operator surface. Returns the finding node from the
    engagement KG, every node linked to it (1-hop, both directions),
    the tamper-evidence status of the workspace chain-of-custody
    manifest, and the asciicast recordings captured for the engagement.

    Args:
        finding_id: Graph node id from ``search_knowledge`` results.

    Returns:
        JSON {finding, linked, custody, recordings}. A node with a retained
        scanner capture also returns captured_source (integrity + a scoped
        parser-membership assessment); a node with a verification reference
        also returns verification (a scoped differential outcome over its
        proof/control captures). Neither ever promotes a security claim.
    """
    from raptix.execution.tools.reporting.kg_adapter import load_engagement_graph
    from raptix_core.types.kg import KnowledgeGraph
    from raptix_core.utils.engagement_scope import get_active_engagement

    configurable = (config or {}).get("configurable") or {}
    # Resolve the engagement the same way the capture producer does
    # (kg_autoingest: ``kg_engagement`` then ``engagement_name``) so the
    # descriptor's recorded engagement matches the graph partition; the
    # contextvar is only a fallback for callers without injected state.
    engagement = (
        (state or {}).get("kg_engagement")
        or (state or {}).get("engagement_name")
        or get_active_engagement()
        or configurable.get("engagement_name")
    )
    graph: KnowledgeGraph = load_engagement_graph(engagement) if engagement else KnowledgeGraph()
    node = graph.nodes.get(finding_id)
    if node is None:
        return _json({"error": f"no node {finding_id} in graph"})

    linked: list[dict[str, Any]] = []
    for edge in graph.edges.values():
        if edge.src == finding_id:
            other = graph.nodes.get(edge.dst)
        elif edge.dst == finding_id:
            other = graph.nodes.get(edge.src)
        else:
            continue
        if other is None:
            continue
        linked.append(
            {
                "edge": edge.kind.value if hasattr(edge.kind, "value") else str(edge.kind),
                "direction": "out" if edge.src == finding_id else "in",
                "node": {"id": other.id, "kind": other.kind.value, "label": other.label},
            }
        )

    evidence_root = _evidence_root("")
    custody = _verify_manifest(evidence_root)
    recordings = list_recordings(_evidence_dir())
    result: dict[str, Any] = {
        "finding": {
            "id": node.id,
            "kind": node.kind.value,
            "label": node.label,
            "props": node.props,
        },
        "linked": linked,
        "custody": custody,
        "recordings": recordings,
    }

    # A retained scanner capture is finding-specific: resolve exact bytes and
    # assess only whether this output emits the recorded node identity. It is
    # deliberately independent of the whole-workspace custody above and never
    # promotes a security claim.
    if node.props.get("source_artifact_ref"):
        result["captured_source"] = _inspect_captured_source(
            node, config, state, configurable, engagement
        )

    # A verification reference re-derives a differential outcome from the two
    # retained proof/control captures. Scoped to that one claim; never sets
    # Finding.validated and never treated as independent corroboration.
    if node.props.get("verification_ref"):
        result["verification"] = _inspect_verification(
            node, config, state, configurable, engagement
        )
    return _json(result)


def _evidence_scope(state: dict | None, configurable: dict) -> tuple[str | None, str | None]:
    """Resolve the scoped (workspace, sandbox_url) from run config / state."""
    from raptix.middleware.filesystem import _normalize_engagement_workspace

    raw_workspace = configurable.get("workspace_path") or (state or {}).get("workspace_path")
    workspace = (
        _normalize_engagement_workspace(raw_workspace) if isinstance(raw_workspace, str) else None
    )
    url = configurable.get("sandbox_url")
    return workspace, url if isinstance(url, str) and url else None


def _scoped_sandbox(config: RunnableConfig, configurable: dict, url: str) -> Any:
    from raptix.execution.backends.factory import build_sandbox_backend

    return build_sandbox_backend(
        {**(config or {}), "configurable": {**configurable, "sandbox_url": url}}
    )


def _rederive_verification_outcome(
    reference: Any,
    *,
    sandbox: Any,
    workspace: str,
    engagement: str,
    finding_id: str | None = None,
) -> dict[str, Any]:
    """Resolve a verification reference and re-derive its differential outcome.

    Shared by the KG consumer (``_inspect_verification``) and the workspace
    consumer (``recheck_workspace_verification``). References and records are
    untrusted: anything malformed, missing or drifted is inconclusive, never a
    promotion.
    """
    from raptix.execution.tools.evidence.artifacts import resolve_verification, verify_capture_pair

    def inconclusive(reason: str) -> dict[str, Any]:
        return {"outcome": "inconclusive", "reason": reason}

    try:
        record = resolve_verification(
            reference, sandbox=sandbox, workspace=workspace, engagement=engagement
        )
    except Exception as exc:  # noqa: BLE001 — an untrusted reference cannot promote a claim
        return inconclusive(f"inspection_failed:{type(exc).__name__}")
    if "error" in record:
        failure = inconclusive(record["error"])
        if "integrity" in record:
            failure["integrity"] = record["integrity"]
        return failure
    if finding_id is not None:
        if record.get("finding_id") != finding_id:
            return inconclusive("finding_binding_mismatch")
        if not isinstance(record.get("execution"), dict):
            return inconclusive("missing_execution_context")
    proof_ref = record.get("proof_ref")
    control_ref = record.get("control_ref")
    if not all(isinstance(value, str) and value for value in (proof_ref, control_ref)):
        return inconclusive("invalid_verification_record")
    try:
        outcome = verify_capture_pair(
            proof_ref=proof_ref,
            control_ref=control_ref,
            success_patterns=record.get("success_patterns") or [],
            negative_patterns=record.get("negative_patterns") or [],
            sandbox=sandbox,
            workspace=workspace,
            engagement=engagement,
            execution=record.get("execution"),
        )
        if record.get("invocation_id"):
            outcome["invocation_id"] = record["invocation_id"]
        return outcome
    except Exception as exc:  # noqa: BLE001 — an untrusted reference cannot promote a claim
        return inconclusive(f"inspection_failed:{type(exc).__name__}")


def _inspect_verification(
    node: Any,
    config: RunnableConfig,
    state: dict | None,
    configurable: dict,
    engagement: str | None,
) -> dict[str, Any]:
    workspace, url = _evidence_scope(state, configurable)
    if not workspace or not url or not engagement:
        return {"outcome": "inconclusive", "reason": "missing_run_context"}
    key = node.props.get("key")
    finding_id = (
        key.removeprefix("finding::")
        if isinstance(key, str) and key.startswith("finding::")
        else None
    )
    if not finding_id or not _VERIFICATION_ID.fullmatch(finding_id):
        return {"outcome": "inconclusive", "reason": "missing_finding_binding"}
    try:
        sandbox = _scoped_sandbox(config, configurable, url)
    except Exception as exc:  # noqa: BLE001 — inspection failures cannot promote a claim
        return {"outcome": "inconclusive", "reason": f"inspection_failed:{type(exc).__name__}"}
    return _rederive_verification_outcome(
        node.props["verification_ref"],
        sandbox=sandbox,
        workspace=workspace,
        engagement=engagement,
        finding_id=finding_id,
    )


def _inspect_captured_source(
    node: Any,
    config: RunnableConfig,
    state: dict | None,
    configurable: dict,
    engagement: str | None,
) -> dict[str, Any]:
    from raptix.execution.backends.factory import build_sandbox_backend
    from raptix.execution.tools.evidence.artifacts import inspect_artifact_source

    workspace, url = _evidence_scope(state, configurable)
    # Explicit run config only: an ambient SANDBOX_URL has no per-engagement
    # scope guarantee (a subagent would silently bind the process-wide daemon),
    # so its absence returns missing_run_context rather than resolving a capture.
    captured_source: dict[str, Any] = {
        "integrity": "unavailable",
        "assessment": {
            "scope": "scanner_output_membership",
            "outcome": "inconclusive",
            "reason": "missing_run_context",
        },
    }
    if not workspace or not url or not engagement:
        return captured_source
    try:
        run_config = {**(config or {}), "configurable": {**configurable, "sandbox_url": url}}
        captured_source = inspect_artifact_source(
            node,
            sandbox=build_sandbox_backend(run_config),
            workspace=workspace,
            engagement=engagement,
        )
    except Exception as exc:  # noqa: BLE001 — inspection failures cannot promote a claim
        captured_source["assessment"]["reason"] = f"inspection_failed:{type(exc).__name__}"
    return captured_source


_VERIFICATION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
# The verifier persists validate_workspace_finding's result under this directory
# (see intelligence/prompts/plugins/verifier.md); keep reader and prompt in step.
_VERIFICATION_EVIDENCE_DIR = "findings/evidence"


@tool
def recheck_workspace_verification(
    finding_id: str,
    config: RunnableConfig,
    state: Annotated[dict | None, InjectedState] = None,
) -> str:
    """Re-derive a persisted differential verification from retained captures.

    The verifier persists ``validate_workspace_finding``'s result (including
    ``verification_ref``) at ``findings/evidence/<finding>_verification.json``.
    This re-resolves that reference and re-runs the proof/control differential
    over the retained captures, so the outcome survives even if the original
    response output was overwritten. Read-only: it never sets ``Finding.validated``
    and never promotes a security claim.

    Args:
        finding_id: The id used for the verification file (e.g. ``FIND-001``).
    """
    return _json(_read_workspace_verification(finding_id, config, state))


def _read_workspace_verification(
    finding_id: str, config: RunnableConfig, state: dict | None
) -> dict[str, Any]:
    """Share the same scoped read and binding policy for recheck and promotion."""
    from raptix.execution.tools.evidence.artifacts import MAX_DESCRIPTOR_BYTES

    if not _VERIFICATION_ID.fullmatch(finding_id or ""):
        return {"error": "invalid finding_id"}
    configurable = (config or {}).get("configurable") or {}
    scope = state or {}
    workspace, url = _evidence_scope(scope, configurable)
    engagement = scope.get("kg_engagement") or scope.get("engagement_name")
    if not workspace or not url or not engagement:
        return {"error": "missing_run_context"}
    try:
        sandbox = _scoped_sandbox(config, configurable, url)
    except Exception as exc:  # noqa: BLE001 — inspection failures cannot promote a claim
        return {"finding_id": finding_id, "error": f"inspection_failed:{type(exc).__name__}"}
    path = f"{workspace}/{_VERIFICATION_EVIDENCE_DIR}/{finding_id}_verification.json"
    try:
        files = sandbox.download_files(
            [path], workspace_path=workspace, max_bytes=MAX_DESCRIPTOR_BYTES
        )
    except Exception as exc:  # noqa: BLE001 — inspection failures cannot promote a claim
        return {"finding_id": finding_id, "error": f"inspection_failed:{type(exc).__name__}"}
    if len(files) != 1 or files[0].path != path:
        return {"finding_id": finding_id, "error": "transfer_failed"}
    if files[0].error:
        reason = files[0].error
        return {"finding_id": finding_id, "error": reason}
    try:
        payload = json.loads(files[0].content or b"")
    except (TypeError, ValueError):
        return {"finding_id": finding_id, "error": "invalid_verification_json"}
    reference = payload.get("verification_ref") if isinstance(payload, dict) else None
    if not isinstance(reference, str) or not reference:
        return {"finding_id": finding_id, "error": "no_verification_ref"}
    if payload.get("vuln_id") != finding_id:
        return {
            "finding_id": finding_id,
            "verification": {"outcome": "inconclusive", "reason": "finding_binding_mismatch"},
        }
    outcome = _rederive_verification_outcome(
        reference,
        sandbox=sandbox,
        workspace=workspace,
        engagement=engagement,
        finding_id=finding_id,
    )
    return {"finding_id": finding_id, "verification_ref": reference, "verification": outcome}


@tool
def record_workspace_finding(
    finding_id: str,
    config: RunnableConfig,
    state: Annotated[dict | None, InjectedState] = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> str:
    """Promote a verified workspace finding into the engagement KG.

    Deterministic bridge for the workspace-first verifier: read
    ``findings/evidence/<finding>_verification.json``, confirm it belongs to
    ``finding_id``, and upsert a ``Finding`` node carrying ``verification_ref``
    so the KG consumer (``inspect_evidence``) can re-derive the differential
    outcome. A missing, foreign, malformed or unbound verification — or an
    unavailable graph store — writes nothing. Only a supported recheck is
    recorded; other outcomes remain available through the read-only recheck.
    Never sets ``Finding.validated``.

    Args:
        finding_id: The verification file's finding id (e.g. ``FIND-001``).
    """
    from raptix_core.types.kg import Node, NodeKind

    checked = _read_workspace_verification(finding_id, config, state)
    if "error" in checked:
        return _json(checked)
    outcome = checked["verification"]
    if outcome.get("outcome") != "supported":
        return _json({**checked, "error": "verification_not_supported"})
    reference = checked["verification_ref"]
    scope = state or {}
    engagement = scope.get("kg_engagement") or scope.get("engagement_name")
    from raptix.knowledge.graph.store import (
        KGStore,
        KGStoreConfigError,
        KGStoreUnavailableError,
    )

    try:
        store = KGStore.from_env()
    except (KGStoreConfigError, KGStoreUnavailableError, ImportError) as exc:
        return _json({"finding_id": finding_id, "error": f"kg_unavailable:{type(exc).__name__}"})
    node_key = f"finding::{finding_id}"
    observation = {
        "kind": NodeKind.FINDING.value,
        "key": node_key,
        "label": finding_id,
        "props": {
            "verification_ref": reference,
            "verification_outcome": outcome.get("outcome"),
            "verification_invocation_id": outcome.get("invocation_id"),
            "source": "workspace_verification",
        },
        "edges_out": [],
    }
    try:
        written = store.record_observations(
            [observation],
            engagement=engagement,
            created_by=str(scope.get("role") or scope.get("agent_name") or "agent"),
            source_episode_id=tool_call_id,
        )
    except Exception as exc:  # noqa: BLE001 — surface write failure, never a silent success
        return _json({"finding_id": finding_id, "error": f"kg_write_failed:{type(exc).__name__}"})
    finally:
        store.close()
    node_id = Node.make(NodeKind.FINDING, finding_id, key=node_key).id
    return _json(
        {
            "finding_id": finding_id,
            "node_id": node_id,
            "verification_outcome": outcome.get("outcome"),
            "graph": written,
        }
    )


EVIDENCE_TOOLS = [
    inspect_evidence,
    recheck_workspace_verification,
    record_workspace_finding,
    seal_evidence,
    export_session_asciicast,
    list_session_recordings,
]
