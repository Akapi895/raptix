"""Bind generated citations to completed, claim-scoped replay reads."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence, Set
from typing import Any

_REFERENCE = re.compile(r"workspace-evidence://[0-9a-f]{64}\Z")
_UNBOUND = {"finding_binding_mismatch", "missing_execution_context"}


def _sources(
    claim_replays: Set[str], observations: Mapping[str, dict[str, Any]], issues: list[str]
) -> dict[str, str]:
    sources: dict[str, str] = {}
    conflicted: set[str] = set()
    for lookup in sorted(claim_replays & observations.keys()):
        replay = observations[lookup]
        reason = replay.get("reason")
        if (
            "error" in replay
            or (isinstance(reason, str) and reason in _UNBOUND)
            or "reference" not in replay
        ):
            continue
        if "reason" in replay and not isinstance(reason, str):
            issues.append("invalid_source_metadata")
            continue
        reference, invocation = replay["reference"], replay.get("invocation_id")
        if not isinstance(reference, str) or not _REFERENCE.fullmatch(reference):
            issues.append("invalid_source_reference")
            continue
        if not isinstance(invocation, str) or not invocation.strip():
            issues.append("missing_producer_invocation")
            continue
        if reference in sources and sources[reference] != invocation:
            conflicted.add(reference)
            issues.append("conflicting_reference")
        sources[reference] = invocation
    return {ref: invocation for ref, invocation in sources.items() if ref not in conflicted}


def audit_provenance(
    *,
    evidence_refs: Sequence[str],
    lineage_count: int,
    claim_replays: Set[str],
    declared_replays: Set[str],
    observations: Mapping[str, dict[str, Any]],
    requires_evidence: bool = False,
    forbidden_tools: Sequence[str] = (),
    episode_error: str | None = None,
) -> dict[str, Any]:
    """Fail closed without repairing citations or consulting expected decisions."""
    issues = [
        issue
        for failed, issue in (
            (bool(episode_error), "episode_failed"),
            (not claim_replays or not claim_replays <= declared_replays, "invalid_claim_binding"),
            (not claim_replays <= observations.keys(), "claim_reads_incomplete"),
            (bool(observations.keys() - declared_replays), "outside_replay_scope"),
            (bool(forbidden_tools), "forbidden_tool_attempt"),
        )
        if failed
    ]
    sources = _sources(claim_replays, observations, issues)
    unknown = set(evidence_refs) - sources.keys()
    derived = None if unknown else len({sources[ref] for ref in evidence_refs})
    issues.extend(
        issue
        for failed, issue in (
            (len(evidence_refs) != len(set(evidence_refs)), "duplicate_reference"),
            (any(not _REFERENCE.fullmatch(ref) for ref in evidence_refs), "invalid_reference"),
            (bool(unknown), "unknown_reference"),
            (requires_evidence and not evidence_refs, "missing_evidence"),
            (derived is None, "unresolved_lineage"),
            (derived is not None and lineage_count != derived, "lineage_mismatch"),
        )
        if failed
    )
    return {
        "accepted": not issues,
        "issues": list(dict.fromkeys(issues)),
        "derived_lineage_count": derived,
    }
