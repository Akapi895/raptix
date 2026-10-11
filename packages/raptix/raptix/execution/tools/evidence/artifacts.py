"""Retain bounded scanner captures and assess their recorded source identity."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import asdict, replace
from typing import Any

from raptix.knowledge.ingest import default_registry
from raptix.specialist_contracts.evidence import validate_evidence
from raptix_core.types.capability import Artifact
from raptix_core.types.kg import Node

MAX_CAPTURE_BYTES = 256_000
MAX_DESCRIPTOR_BYTES = 16_000
_REFERENCE = re.compile(r"workspace-evidence://([0-9a-f]{64})\Z")


class EvidenceCaptureError(ValueError):
    """A capture cannot be retained or resolved within its declared scope.

    ``integrity`` classifies the retrieval state ("missing", "drift",
    "oversized", ...) so callers never parse the message text to decide it.
    """

    def __init__(self, reason: str, *, integrity: str = "unavailable") -> None:
        super().__init__(reason)
        self.integrity = integrity


def _paths(reference: str, workspace: str) -> tuple[str, str]:
    from raptix.middleware.filesystem import _normalize_engagement_workspace

    root = _normalize_engagement_workspace(workspace)
    match = _REFERENCE.fullmatch(reference)
    if root is None or match is None:
        raise EvidenceCaptureError("invalid_reference_or_workspace")
    prefix = f"{root}/evidence/scanner-captures/{match[1]}"
    return f"{prefix}.json", f"{prefix}.bin"


_READ_ERROR_INTEGRITY = {"file_not_found": "missing", "file_too_large": "oversized"}


def _read(sandbox: Any, path: str, workspace: str, limit: int) -> bytes:
    files = sandbox.download_files([path], workspace_path=workspace, max_bytes=limit)
    if len(files) != 1 or files[0].path != path:
        raise EvidenceCaptureError("transfer_failed")
    if files[0].error:
        reason = _READ_ERROR_INTEGRITY.get(files[0].error, "unavailable")
        raise EvidenceCaptureError(reason, integrity=reason)
    content = files[0].content
    if not isinstance(content, bytes) or len(content) > limit:
        raise EvidenceCaptureError("oversized_or_unavailable", integrity="oversized")
    return content


def retain_artifact(
    artifact: Artifact,
    content: bytes,
    *,
    sandbox: Any,
    workspace: str,
    engagement: str,
    parser_id: str | None = None,
    parser_version: str | None = None,
) -> Artifact:
    """Copy exact bytes and context; the descriptor digest is the opaque reference.

    ``parser_id``/``parser_version`` identify a deterministic re-parser when one
    exists (the T3 registry). Legacy adapter producers pass ``None``: their
    capture is retained and integrity-checked, but membership is not re-derived
    here because the adapter and registry use different node identities.
    """
    if not engagement or len(content) > MAX_CAPTURE_BYTES:
        raise EvidenceCaptureError("invalid_scope_or_oversized")
    retained = replace(artifact, sha256=hashlib.sha256(content).hexdigest())
    artifact_fields = asdict(retained)
    artifact_fields.pop("artifact_ref")
    descriptor = json.dumps(
        {
            "engagement": engagement,
            "artifact": artifact_fields,
            "parser_id": parser_id,
            "parser_version": parser_version,
        },
        sort_keys=True,
        ensure_ascii=True,
    ).encode("utf-8")
    if len(descriptor) > MAX_DESCRIPTOR_BYTES:
        raise EvidenceCaptureError("oversized_descriptor")
    reference = f"workspace-evidence://{hashlib.sha256(descriptor).hexdigest()}"
    descriptor_path, content_path = _paths(reference, workspace)
    uploaded = sandbox.upload_files(
        [(content_path, content), (descriptor_path, descriptor)], workspace_path=workspace
    )
    if {item.path for item in uploaded} != {content_path, descriptor_path} or any(
        item.error for item in uploaded
    ):
        raise EvidenceCaptureError("capture_upload_failed")
    return replace(retained, artifact_ref=reference)


def retain_capture(
    content: bytes,
    *,
    sandbox: Any,
    workspace: str,
    engagement: str,
    producer: str,
    format_hint: str | None = None,
) -> str:
    """Retain exact bytes as an opaque capture; returns its reference.

    Used for evidence that has no scanner parser (a PoC proof or a baseline
    control). Reuses the descriptor/integrity machinery of ``retain_artifact``;
    two byte-identical captures collapse to one reference.
    """
    digest = hashlib.sha256(content).hexdigest()
    artifact = Artifact(
        id=f"capture::{digest[:16]}",
        artifact_ref=f"capture://{digest}",
        format_hint=format_hint,
        producer=producer,
    )
    return retain_artifact(
        artifact, content, sandbox=sandbox, workspace=workspace, engagement=engagement
    ).artifact_ref


def record_verification(
    *,
    proof_ref: str,
    control_ref: str,
    success_patterns: Sequence[str],
    negative_patterns: Sequence[str],
    sandbox: Any,
    workspace: str,
    engagement: str,
    producer: str,
) -> str:
    """Persist a proof/control pair and its patterns as one opaque reference.

    A finding node carries this single ``verification_ref``; the consumer
    re-derives the differential outcome from the two retained captures.
    """
    record = json.dumps(
        {
            "proof_ref": proof_ref,
            "control_ref": control_ref,
            "success_patterns": list(success_patterns),
            "negative_patterns": list(negative_patterns),
        },
        sort_keys=True,
        ensure_ascii=True,
    ).encode("utf-8")
    return retain_capture(
        record,
        sandbox=sandbox,
        workspace=workspace,
        engagement=engagement,
        producer=producer,
        format_hint="verification",
    )


def _load_capture(
    reference: Any, *, sandbox: Any, workspace: str, engagement: str
) -> tuple[bytes | None, str, str | None]:
    """Resolve a capture's bytes and integrity without a node to compare to."""
    try:
        descriptor_path, content_path = _paths(str(reference), workspace)
        descriptor = _read(sandbox, descriptor_path, workspace, MAX_DESCRIPTOR_BYTES)
        if hashlib.sha256(descriptor).hexdigest() != str(reference).rsplit("/", 1)[-1]:
            raise EvidenceCaptureError("descriptor_drift", integrity="drift")
        data = json.loads(descriptor)
        if data.get("engagement") != engagement:
            raise EvidenceCaptureError("scope_mismatch")
        content = _read(sandbox, content_path, workspace, MAX_CAPTURE_BYTES)
        expected = (data.get("artifact") or {}).get("sha256")
        if not isinstance(expected, str) or hashlib.sha256(content).hexdigest() != expected:
            raise EvidenceCaptureError("content_drift", integrity="drift")
        return content, "ok", None
    except EvidenceCaptureError as exc:
        return None, exc.integrity, str(exc)


def resolve_verification(
    reference: str, *, sandbox: Any, workspace: str, engagement: str
) -> dict[str, Any]:
    """Load a verification record (proof/control refs + patterns)."""
    content, integrity, reason = _load_capture(
        reference, sandbox=sandbox, workspace=workspace, engagement=engagement
    )
    if content is None:
        return {"error": reason or "capture_unavailable", "integrity": integrity}
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {"error": "invalid_verification_record"}
    return data if isinstance(data, dict) else {"error": "invalid_verification_record"}


def verify_capture_pair(
    *,
    proof_ref: str,
    control_ref: str,
    success_patterns: Sequence[str],
    negative_patterns: Sequence[str],
    sandbox: Any,
    workspace: str,
    engagement: str,
) -> dict[str, Any]:
    """Differential source check on two retained captures.

    supported    — proof matches a success pattern, control matches a baseline
                   pattern, and the control does NOT match any success pattern.
    contradicted — the control also matched a success pattern (the differential
                   claim is refuted).
    inconclusive — a capture is missing/drifted, a pattern is invalid, or the
                   signal is insufficient.

    This is a scoped differential observation, never exploitability, CVSS,
    target liveness, or independent corroboration.
    """
    proof, proof_integrity, _ = _load_capture(
        proof_ref, sandbox=sandbox, workspace=workspace, engagement=engagement
    )
    control, control_integrity, _ = _load_capture(
        control_ref, sandbox=sandbox, workspace=workspace, engagement=engagement
    )
    result: dict[str, Any] = {
        "scope": "differential_response",
        "outcome": "inconclusive",
        "integrity": {"proof": proof_integrity, "control": control_integrity},
    }
    if proof is None or control is None:
        result["reason"] = "capture_unavailable"
        return result
    validation = validate_evidence(
        proof.decode("utf-8", "replace"),
        control.decode("utf-8", "replace"),
        success_patterns=list(success_patterns),
        negative_patterns=list(negative_patterns),
    )
    result["success_matches"] = list(validation.success_matches)
    result["negative_matches"] = list(validation.negative_matches)
    result["noise_matches"] = list(validation.noise_matches)
    if validation.validated:
        result["outcome"] = "supported"
    elif validation.noise_matches:
        result["outcome"] = "contradicted"
    else:
        result["reason"] = "; ".join(validation.errors) or "insufficient_signal"
    return result


def inspect_artifact_source(
    node: Node, *, sandbox: Any, workspace: str, engagement: str
) -> dict[str, Any]:
    """Resolve raw bytes, check integrity, then assess parser-output membership."""
    reference = node.props.get("source_artifact_ref")
    result: dict[str, Any] = {
        "artifact_ref": reference,
        "integrity": "unavailable",
        "assessment": {"scope": "scanner_output_membership", "outcome": "inconclusive"},
    }
    try:
        descriptor_path, content_path = _paths(str(reference), workspace)
        descriptor = _read(sandbox, descriptor_path, workspace, MAX_DESCRIPTOR_BYTES)
        if hashlib.sha256(descriptor).hexdigest() != str(reference).rsplit("/", 1)[-1]:
            raise EvidenceCaptureError("descriptor_drift", integrity="drift")
        data = json.loads(descriptor)
        artifact = Artifact(artifact_ref=reference, **data["artifact"])
        recorded_parser = node.props.get("parser_id")
        if (
            data["engagement"] != engagement
            or artifact.id != node.props.get("source_artifact_id")
            or (
                recorded_parser is not None and data.get("parser_id") not in (None, recorded_parser)
            )
        ):
            raise EvidenceCaptureError("scope_or_artifact_mismatch")
        content = _read(sandbox, content_path, workspace, MAX_CAPTURE_BYTES)
        if hashlib.sha256(content).hexdigest() != artifact.sha256:
            raise EvidenceCaptureError("content_drift", integrity="drift")
        result.update(integrity="ok", sha256=artifact.sha256, size=len(content))
        _assess_source(result, node, artifact, content, data)
    except EvidenceCaptureError as exc:
        result["integrity"] = exc.integrity
        result["assessment"]["reason"] = str(exc)
    except Exception as exc:  # noqa: BLE001 — inspection returns uncertainty, never promotes on failure
        result["assessment"]["reason"] = f"inspection_failed:{type(exc).__name__}"
    return result


def _assess_source(
    result: dict[str, Any], node: Node, artifact: Artifact, content: bytes, data: dict[str, Any]
) -> None:
    """Re-derive the recorded node identity from the retained bytes, or say why not.

    Only a deterministic registry parser can re-derive identity. When the
    capture's producer has none (legacy adapters), the capture is reported as
    retained/integrity-checked but not source-assessed — never silently promoted.
    """
    parser_id = data.get("parser_id")
    registry = default_registry()
    parser = registry.get(parser_id) if isinstance(parser_id, str) and parser_id else None
    if parser is None:
        result["assessment"] = {
            "scope": "capture_retention",
            "outcome": "not_assessed",
            "reason": "no_registered_parser",
        }
        return
    if parser.parser_version != data.get("parser_version"):
        # Bytes verified intact; only the recorded parser version is gone, so the
        # source check is inconclusive rather than reinterpreted under a newer parser.
        raise EvidenceCaptureError("parser_version_unavailable", integrity="ok")
    outcome = registry.parse(artifact, content, expected_formats=(parser_id,))
    matched = any(
        observation.kind == node.kind.value and observation.data.get("key") == node.props.get("key")
        for observation in outcome.observations
    )
    result["assessment"] = {
        "scope": "scanner_output_membership",
        "outcome": "supported" if matched else "contradicted",
        "parser_id": outcome.format_id,
        "parser_version": outcome.parser_version,
    }
