"""Structured compaction-summary contract and deterministic validator (ADR-0053).

The upstream ``DEFAULT_SUMMARY_PROMPT`` keeps its four base sections; the
structured contract is *appended* by the raptix summarization slot when
``RAPTIX_SUMMARY_STRUCTURED=1``. This module owns the prompt fragment and the
LLM-free validator the transactional commit path (ADR-0052) consumes: schema
and reference checks are hard gates, semantic fidelity is deliberately left to
an optional advisory pass (never the sole gate).
"""

from __future__ import annotations

import json
import re
from typing import Any

REQUIRED_HEADERS: tuple[str, ...] = (
    "## SESSION INTENT",
    "## SUMMARY",
    "## ARTIFACTS",
    "## NEXT STEPS",
)

STRUCTURED_SECTIONS: tuple[str, ...] = (
    "completed_work",
    "evidence",
    "failed_attempts",
    "unresolved",
    "hypotheses",
)

STRUCTURED_SUMMARY_PROMPT = """

## STRUCTURED_STATE

After the four sections above, emit exactly one fenced ```json block with this shape:

{"completed_work": [{"ref": "<task-state evidence ref>", "evidence": true}],
 "evidence": [{"ref": "<ref that exists in the workspace or task state>"}],
 "failed_attempts": [{"action_hash": "<ledger action hash>", "reason": "...", "retry_condition": "..."}],
 "unresolved": [{"summary": "..."}],
 "hypotheses": ["<claims not yet proven>"]}

Rules:
- Every `ref` must reference persisted state (a task-state evidence ref, a ledger
  action hash, or a file in the workspace). Never invent a reference.
- A `completed_work` item is only `evidence: true` when an `evidence` ref backs it.
- Put anything not backed by a persisted source under `hypotheses`, never under
  `completed_work` or `evidence`.
"""
# LangChain formats this template with str.format(messages=...). JSON braces
# are literal model instructions, not template variables.
STRUCTURED_SUMMARY_PROMPT = STRUCTURED_SUMMARY_PROMPT.replace("{", "{{").replace("}", "}}")

_FENCED_JSON = re.compile(r"```json\s*(?P<body>.*?)```", re.DOTALL)


def unwrap_summary(content: str) -> str:
    """Return the model-authored summary body, stripping deepagents' envelope."""
    if content.startswith("You are in the middle of a conversation that has been summarized."):
        return content.partition("<summary>\n")[2]
    if content.startswith("Here is a summary of the conversation to date:\n\n"):
        return content.partition("\n\n")[2]
    return content


def has_required_headers(content: str) -> bool:
    """Stop-gap structure gate: the four base sections must be present."""
    body = unwrap_summary(content)
    return all(header in body for header in REQUIRED_HEADERS)


def parse_structured_section(content: str) -> tuple[dict[str, Any] | None, str | None]:
    """Extract and parse the fenced JSON block; return (data, error)."""
    matches = list(_FENCED_JSON.finditer(unwrap_summary(content)))
    if len(content.encode("utf-8")) > 100_000:
        return None, "structured summary exceeds byte cap"
    if not matches:
        return None, "missing structured JSON block"
    if len(matches) != 1:
        return None, "ambiguous structured JSON blocks"
    try:
        data = json.loads(matches[0].group("body"))
    except json.JSONDecodeError as exc:
        return None, f"structured block is not valid JSON: {exc.msg}"
    if not isinstance(data, dict):
        return None, "structured block must be a JSON object"
    return data, None


def validate_structured_summary(
    content: str,
    *,
    action_hashes: list[str] | None = None,
    evidence_refs: list[str] | None = None,
    backend: Any = None,
) -> tuple[bool, list[str]]:
    """Deterministic gate for a structured summary.

    Schema checks always run. Reference checks run when ``backend`` is
    available (a ref must be a known task-state/ledger ref or a readable file);
    when the backend cannot be resolved the reference existence check is
    skipped rather than failing the summary, so environments without a
    workspace backend keep compacting. Returns ``(ok, errors)``.
    """
    data, error = parse_structured_section(content)
    if error is not None or data is None:
        return False, [error or "missing structured JSON block"]

    errors: list[str] = []
    for section in STRUCTURED_SECTIONS:
        if not isinstance(data.get(section), list) or len(data[section]) > 50:
            errors.append(f"missing list '{section}'")
    if errors:
        return False, errors

    known = set(evidence_refs or [])

    def _ref_resolves(ref: str) -> bool:
        if ref in known and not ref.startswith("/"):
            return True
        if backend is None:
            return False
        try:
            return not backend.read(ref, offset=0, limit=1).error
        except Exception:  # noqa: BLE001 — unresolved references refuse compaction
            return False

    for item in data["evidence"]:
        ref = item.get("ref") if isinstance(item, dict) else None
        if not isinstance(ref, str) or not ref or len(ref) > 512 or set(item) != {"ref"}:
            errors.append("evidence entry missing ref")
        elif not _ref_resolves(ref):
            errors.append("unresolved evidence ref")

    for item in data["completed_work"]:
        if not isinstance(item, dict):
            errors.append("completed_work entry must be an object")
            continue
        if item.get("evidence") is True and set(item) == {"ref", "evidence"}:
            ref = item.get("ref")
            if not isinstance(ref, str) or not ref:
                errors.append("completed_work marked evidence has no ref")
            elif ref not in {
                entry.get("ref") for entry in data["evidence"] if isinstance(entry, dict)
            } or not _ref_resolves(ref):
                errors.append("unresolved completed_work ref")
        else:
            errors.append("completed work requires evidence; unproven claims belong to hypotheses")

    action_set = set(action_hashes or [])
    for item in data["failed_attempts"]:
        if not isinstance(item, dict):
            errors.append("failed_attempts entry must be an object")
            continue
        digest = item.get("action_hash")
        if not isinstance(digest, str) or digest not in action_set:
            errors.append("unknown ledger action hash")
        if set(item) != {"action_hash", "reason", "retry_condition"}:
            errors.append("invalid failed_attempts fields")
        if any(
            not isinstance(item.get(field), str) or len(item[field]) > 2000
            for field in ("reason", "retry_condition")
        ):
            errors.append("invalid failed_attempts text")

    if any(
        not isinstance(item, dict)
        or set(item) != {"summary"}
        or not isinstance(item["summary"], str)
        for item in data["unresolved"]
    ):
        errors.append("invalid unresolved entries")
    if any(not isinstance(hypothesis, str) for hypothesis in data["hypotheses"]):
        errors.append("invalid hypotheses entries")

    lowered_hypotheses = {str(h).strip().lower() for h in data["hypotheses"] if isinstance(h, str)}
    for item in data["completed_work"]:
        ref = item.get("ref") if isinstance(item, dict) else None
        if isinstance(ref, str) and ref.strip().lower() in lowered_hypotheses:
            errors.append("hypothesis cited as completed work")

    return (not errors), errors


__all__ = [
    "REQUIRED_HEADERS",
    "STRUCTURED_SECTIONS",
    "STRUCTURED_SUMMARY_PROMPT",
    "has_required_headers",
    "parse_structured_section",
    "unwrap_summary",
    "validate_structured_summary",
]
