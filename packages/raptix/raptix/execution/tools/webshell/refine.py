"""LLM-assisted profile refinement (M2.2, ADR-0105).

When deterministic derivation returns ``needs_refinement``, the sealed PoC and the
failure reason are sent to an LLM *with no tools* which returns a JSON profile
proposal.  Code validates and probes; the LLM cannot create connections or run commands.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from raptix.execution.tools.webshell.profile import WebShellProfile, normalize_target

_PROMPT_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "intelligence"
    / "prompts"
    / "webshell"
    / "acquire.md"
)
_MAX_FAILURE_CHARS = 4096


def _load_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def build_refine_messages(
    sealed_poc: dict[str, Any],
    finding_metadata: dict[str, Any],
    allowed_targets: list[str],
    failure: str | None = None,
) -> list[dict[str, str]]:
    system = _load_prompt()
    user_parts = [
        "## Sealed PoC block",
        f"```json\n{json.dumps(sealed_poc, indent=2)}\n```",
        "",
        "## Finding metadata",
        f"```json\n{json.dumps(finding_metadata, indent=2)}\n```",
        "",
        "## Allowed targets",
        json.dumps(allowed_targets),
    ]
    if failure:
        user_parts.extend(["", "## Derivation failure", failure[:_MAX_FAILURE_CHARS]])
    user_parts.extend(["", "Respond with exactly one JSON object."])
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(user_parts)},
    ]


def _extract_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        body: list[str] = []
        inside = False
        for line in lines:
            if line.startswith("```") and not inside:
                inside = True
                continue
            if line.startswith("```") and inside:
                break
            if inside:
                body.append(line)
        return "\n".join(body)
    return text


def parse_refine_response(text: str, allowed_targets: list[str]) -> dict[str, Any]:
    raw = _extract_json(text)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"status": "failed", "reason": "llm_response_not_json"}
    if not isinstance(data, dict):
        return {"status": "failed", "reason": "llm_response_not_object"}

    kind = data.get("kind")
    if kind == "refused":
        return {"status": "refused", "reason": str(data.get("reason", "LLM declined."))[:2048]}
    if kind != "profile":
        return {"status": "failed", "reason": "llm_response_missing_kind"}

    profile_data = data.get("profile")
    if not isinstance(profile_data, dict):
        return {"status": "failed", "reason": "llm_response_missing_profile"}

    try:
        profile = WebShellProfile.model_validate(profile_data)
    except Exception as exc:
        return {"status": "failed", "reason": f"llm_profile_invalid: {exc}"}

    normalised_allowed = [normalize_target(t) for t in allowed_targets]
    if profile.target not in normalised_allowed:
        return {"status": "refused", "reason": f"llm_profile_target_outside_scope: {profile.target}"}

    return {
        "status": "refined",
        "profile": profile.model_dump(exclude_none=True),
        "confidence": data.get("confidence", "low"),
    }


async def refine_profile(
    model: Any,
    sealed_poc: dict[str, Any],
    finding_metadata: dict[str, Any],
    allowed_targets: list[str],
    failure: str | None = None,
    *,
    timeout_seconds: int = 60,
) -> dict[str, Any]:
    """Call the LLM to propose a WebShell profile from a sealed PoC."""
    messages = build_refine_messages(sealed_poc, finding_metadata, allowed_targets, failure)
    try:
        response = await asyncio.wait_for(model.ainvoke(messages), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        return {"status": "failed", "reason": "llm_timeout"}
    except Exception as exc:
        return {"status": "failed", "reason": f"llm_error: {type(exc).__name__}"}

    text = str(getattr(response, "content", response) or "")
    return parse_refine_response(text, allowed_targets)
