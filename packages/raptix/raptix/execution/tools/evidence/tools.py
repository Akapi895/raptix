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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_core.tools import tool

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
def inspect_evidence(finding_id: str) -> str:
    """Inspect the evidence trail for one finding.

    Verifier/operator surface. Returns the finding node from the
    engagement KG, every node linked to it (1-hop, both directions),
    the tamper-evidence status of the workspace chain-of-custody
    manifest, and the asciicast recordings captured for the engagement.

    Args:
        finding_id: FINDING (or vulnerability) node id — from
            ``search_knowledge`` results or the ``validate_finding``
            return value.

    Returns:
        JSON {finding, linked, custody, recordings}.
    """
    from raptix.execution.tools.reporting.kg_adapter import load_engagement_graph
    from raptix_core.types.kg import KnowledgeGraph
    from raptix_core.utils.engagement_scope import get_active_engagement

    engagement = get_active_engagement()
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
    return _json(
        {
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
    )


EVIDENCE_TOOLS = [
    inspect_evidence,
    seal_evidence,
    export_session_asciicast,
    list_session_recordings,
]
