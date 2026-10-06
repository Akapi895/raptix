"""Tool-exposure telemetry — T0 baseline for the tool-optimization initiative.

Local-only, opt-in instrumentation of ``build_tools()``'s output: which
tools a role's agent is offered this build, and a rough estimate of their
schema size. This is deliberately separate from ``raptix.telemetry`` (the
consent-gated, Tier-A corpus shipped to the maintainer gateway) — exposure
counts are a development signal for the waves in
``docs/tool-optimization-implementation-plan.md`` (T0 baseline, T11
evaluation), never shipped off-machine, and never carry parameter values.

Off by default (zero cost): gated by ``RAPTIX_TOOL_TELEMETRY=1``. No
behavioral change either way — ``build_tools()`` returns the identical
tool list regardless of this flag.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("raptix.tools.exposure")


def _enabled() -> bool:
    return os.environ.get("RAPTIX_TOOL_TELEMETRY", "").strip().lower() in {"1", "true", "yes"}


def _tool_name(tool: Any) -> str:
    name = getattr(tool, "name", None)
    if isinstance(name, str) and name:
        return name
    return getattr(tool, "__name__", repr(tool))


def _schema_char_estimate(tool: Any) -> int:
    """Rough proxy for one tool's schema cost: chars of name + description + args schema.

    Not a real tokenizer count — the plan's ``tool_schema_tokens`` metric is a
    hypothesis to validate at T11, not a precise budget. A stable, cheap,
    model-agnostic proxy is enough to compare "before" vs "after".
    """
    parts = [_tool_name(tool), str(getattr(tool, "description", "") or "")]
    schema = getattr(tool, "args_schema", None)
    if schema is not None:
        try:
            if hasattr(schema, "model_json_schema"):
                parts.append(json.dumps(schema.model_json_schema(), default=str))
            elif hasattr(schema, "schema"):
                parts.append(json.dumps(schema.schema(), default=str))
        except Exception:  # noqa: BLE001 — best-effort estimate, never fatal
            pass
    return sum(len(p) for p in parts)


def summarize_tool_exposure(role: str, tools: list[Any]) -> dict[str, Any]:
    """Pure summary of the tool set offered to ``role`` — no logging, no I/O.

    Used both by :func:`record_tool_exposure` (gated logging inside
    ``build_tools()``) and by the baseline-capture script in
    ``benchmarks/tool_eval/baseline/``, so the two never drift.
    """
    names = sorted({_tool_name(t) for t in tools})
    return {
        "role": role,
        "active_tools_per_turn": len(names),
        "tool_names": names,
        "tool_schema_chars": sum(_schema_char_estimate(t) for t in tools),
    }


def record_tool_exposure(role: str, tools: list[Any]) -> None:
    """Log the tool set offered to ``role`` this build. Never raises, never mutates.

    No-op unless ``RAPTIX_TOOL_TELEMETRY=1``. Logs only tool names/counts/char
    estimates — the schema shape, never a parameter value — mirroring the
    redaction rule ``EventLogMiddleware`` already applies to tool-call args.
    """
    if not _enabled():
        return
    try:
        logger.info(
            "tool_exposure %s", json.dumps(summarize_tool_exposure(role, tools), default=str)
        )
    except Exception:  # noqa: BLE001 — telemetry must never break agent construction
        logger.debug("tool_exposure: record failed", exc_info=True)
