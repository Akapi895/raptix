"""Dynamic tool exposure — Waves T9 (shadow) + T12 (active, role-by-role).

Computes what a *dynamically filtered* tool surface WOULD look like for
a role. Three modes via ``RAPTIX_DYNAMIC_TOOL_EXPOSURE``:

* ``off`` (default) — static surfaces only, nothing logged.
* ``shadow`` — logs the diff, callers keep serving their static tool
  list. The T9 behavior; also the rollback target for ``active``
  (flag flip, no code revert).
* ``active`` — serves the filtered set, but ONLY for roles inside the
  current rollout stage (``RAPTIX_EXPOSURE_ROLLOUT_STAGE``, default 0
  = no roles): recon → exploit → postexploit → ad_operator → analyst
  (last — largest surface, biggest behavior change, per the plan).
  Shadow logging stays on in every non-``off`` mode for ongoing
  regression monitoring.

Exposure logic (docs/tool-optimization-implementation-plan.md, T9):

    eligible =
        role allowed
      ∩ allowed_phases satisfied (hard)
      ∩ AKG requirements satisfied
      ∩ executor available

    ranking_score += phase_affinity_bonus (soft)

``phase_affinity`` only re-ranks the proposed order — it never excludes a
tool. The recovery surface (``RECOVERY_TOOL_NAMES``) is always included in
the proposed set regardless of any eligibility/availability verdict, and
active mode never serves an empty toolset or raises — dynamic exposure is
a UX optimization, never a security control.

The legacy T9 opt-in ``RAPTIX_EXPOSURE_SHADOW=1`` keeps working as an
alias for ``shadow``. An unrecognized mode value fails safe to ``off``.
The log record is the T11 diff data: current vs proposed names, what
would be filtered, and why — tool names and static evaluator reasons
only, never parameter values.

Deviations from the plan's sketch, kept deliberately:

* ``resolve_active_tools`` takes the caller's current tool list — the
  plan's sketch omitted it even though ``ExposureResult.current_tools``
  needs a source.
* ``graph_state`` is a :class:`GraphSnapshot` of caller-computed
  requirement answers, not a live graph handle: the exposure module never
  queries the AKG itself (the frozen T2 no-query rule), and an absent
  requirement id counts as unmet (the conservative T6 default).
* ``ExposureResult`` holds frozen tuples instead of the sketch's lists.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from raptix.capabilities import (
    AvailabilityEvaluator,
    CapabilityRegistry,
    EligibilityEvaluator,
)
from raptix.capabilities.availability import _probe_executable as _default_probe
from raptix.capabilities.registry import UnknownCapabilityError
from raptix_core.types.capability import CapabilityStatus, ImplementationKind, RequirementSpec

logger = logging.getLogger("raptix.tools.exposure")

SHADOW_ENV_VAR = "RAPTIX_EXPOSURE_SHADOW"
EXPOSURE_MODE_ENV_VAR = "RAPTIX_DYNAMIC_TOOL_EXPOSURE"
ROLLOUT_STAGE_ENV_VAR = "RAPTIX_EXPOSURE_ROLLOUT_STAGE"

# The plan's T12 rollout order: recon → exploit → postexploit →
# AD specialists → analyst (last). ``ad_operator`` is served through the
# plugin path today, so its entry stays inert until that path adopts the
# flag — the order still encodes the plan's sequence. Stage N serves the
# first N roles; stage 0 (default) serves none; a stage beyond the tuple
# serves all of it.
ROLLOUT_ORDER: tuple[str, ...] = ("recon", "exploit", "postexploit", "ad_operator", "analyst")

# The plan's recovery surface, always included in the proposed set
# regardless of filtering, plus the runtime spellings the sketch
# predated (``ask_user`` ships as ``ask_user_question``;
# ``inspect_context``/``diagnose_execution`` have no runtime tools yet —
# listed so future tools with those names inherit the guarantee).
RECOVERY_TOOL_NAMES: frozenset[str] = frozenset(
    {
        "inspect_context",
        "search_knowledge",
        "load_skill",
        "ask_user",
        "diagnose_execution",
        "ask_user_question",
    }
)


@dataclass(frozen=True)
class GraphSnapshot:
    """Caller-computed AKG answers for requirement checks.

    The exposure module never queries the knowledge graph itself (the
    frozen T2 rule — no query coupling outside the runtime evaluator):
    the caller hands in the RESULTS, keyed by requirement id. An id
    absent from the mapping counts as unmet — the conservative T6
    default.
    """

    requirement_results: Mapping[str, bool] = field(default_factory=dict)


class _SnapshotRequirements:
    """Adapt a :class:`GraphSnapshot` to the ``RequirementEvaluator`` protocol."""

    def __init__(self, results: Mapping[str, bool]) -> None:
        self._results = results

    def check(self, requirement: RequirementSpec) -> bool:
        return bool(self._results.get(requirement.id, False))


@dataclass(frozen=True)
class ExposureResult:
    """The T9 exposure diff (frozen tuples instead of the sketch's lists).

    proposed_tools — what dynamic exposure would show.
    current_tools  — what the static standard set shows.
    filtered_out   — tools dynamic filtering would remove.
    reason_map     — tool name → why it is filtered out.
    """

    proposed_tools: tuple[Any, ...]
    current_tools: tuple[Any, ...]
    filtered_out: tuple[Any, ...]
    reason_map: Mapping[str, str]


def _tool_name(tool: Any) -> str:
    name = getattr(tool, "name", None)
    if isinstance(name, str) and name:
        return name
    dunder = getattr(tool, "__name__", None)
    if isinstance(dunder, str) and dunder:
        return dunder
    return repr(tool)


def _capability_index(registry: CapabilityRegistry) -> dict[str, str]:
    """Map tool name → capability id from the catalog's in-process
    carriers (``"module:attr"`` implementations). Bare binary names (the
    T7 capabilities) carry no agent tool and contribute no entry. The
    first manifest wins if two capabilities ever resolved to one tool
    name (none do in the current catalog)."""
    index: dict[str, str] = {}
    for manifest in registry:
        for implementation in manifest.implementations:
            if implementation.kind is not ImplementationKind.ADAPTER:
                continue
            executable = implementation.executable or ""
            if ":" not in executable:
                continue
            module_name, _, attr = executable.partition(":")
            if not module_name or not attr:
                continue
            try:
                module = importlib.import_module(module_name)
            except ImportError:
                continue
            obj = getattr(module, attr, None)
            if obj is None:
                continue
            name = getattr(obj, "name", None)
            if not isinstance(name, str) or not name:
                name = getattr(obj, "__name__", None)
            if isinstance(name, str) and name:
                index.setdefault(name, str(manifest.id))
    return index


def _executor_probe(
    available_executors: Collection[str] | None,
) -> Any:  # noqa: ANN401 — probe callables are duck-typed by AvailabilityEvaluator
    """``None`` keeps the evaluator's default probes. An explicit
    executor set overrides the PATH probe for bare binary names; carrier
    import probes still apply (an in-process tool is importable by
    definition)."""
    if available_executors is None:
        return None

    def _probe(executable: str) -> bool:
        if ":" in executable:
            return _default_probe(executable)
        return executable in available_executors

    return _probe


def resolve_active_tools(
    *,
    role: str,
    phase: str | None = None,
    graph_state: GraphSnapshot | None = None,
    available_executors: Collection[str] | None = None,
    current_tools: Sequence[Any],
    registry: CapabilityRegistry | None = None,
    availability: AvailabilityEvaluator | None = None,
) -> ExposureResult:
    """Compute the shadow exposure diff for one role.

    Args:
        role: runtime role id (the eligibility evaluator's role check).
        phase: UKC phase slug (``UKCPhase.value``) when the caller knows
            it; ``None`` at agent-assembly time. Drives the hard
            ``allowed_phases`` constraint and the soft affinity bonus.
        graph_state: caller-computed requirement answers; ``None`` marks
            declared requirements unmet (conservative T6 default).
        available_executors: binary names usable right now; ``None``
            falls back to the availability evaluator's PATH probe.
        current_tools: the static tool list the caller serves today.
        registry: capability registry override (defaults to the catalog).
        availability: availability evaluator override (tests inject
            fakes; production probes imports and PATH).

    Returns:
        The :class:`ExposureResult` diff. The proposed order is a stable
        re-rank of the current order by phase-affinity bonus — ranking
        only ever reorders, never excludes.
    """
    registry = registry or CapabilityRegistry()
    availability = availability or AvailabilityEvaluator(
        executable_probe=_executor_probe(available_executors)
    )
    eligibility_evaluator = EligibilityEvaluator(
        requirement_evaluator=(
            _SnapshotRequirements(graph_state.requirement_results) if graph_state else None
        )
    )
    index = _capability_index(registry)

    current = tuple(current_tools)
    kept: list[tuple[int, Any, int]] = []
    filtered: list[Any] = []
    reasons: dict[str, str] = {}
    for position, tool in enumerate(current):
        name = _tool_name(tool)
        if name in RECOVERY_TOOL_NAMES:
            kept.append((position, tool, 0))
            continue
        capability_id = index.get(name)
        if capability_id is None:
            kept.append((position, tool, 0))
            continue
        try:
            manifest = registry.get(capability_id)
        except UnknownCapabilityError:
            kept.append((position, tool, 0))
            continue
        verdict = eligibility_evaluator.evaluate(manifest, role=role, phase=phase)
        if not verdict.eligible:
            filtered.append(tool)
            reasons[name] = f"{capability_id}: {verdict.reason or 'ineligible'}"
            continue
        state = availability.evaluate(manifest)
        if state.status is CapabilityStatus.UNAVAILABLE:
            filtered.append(tool)
            reasons[name] = f"{capability_id}: executor unavailable"
            continue
        bonus = 1 if (phase is not None and phase in manifest.phase_affinity) else 0
        kept.append((position, tool, bonus))

    # Soft ranking: stable sort by affinity bonus, original order within
    # equal rank. Exclusion already happened above via the hard checks.
    kept.sort(key=lambda entry: (-entry[2], entry[0]))
    proposed = tuple(tool for _, tool, _ in kept)
    return ExposureResult(
        proposed_tools=proposed,
        current_tools=current,
        filtered_out=tuple(filtered),
        reason_map=reasons,
    )


def summarize_exposure_result(
    result: ExposureResult,
    *,
    role: str,
    phase: str | None,
) -> dict[str, Any]:
    """Pure T11 diff summary — no logging, no I/O, no parameter values."""
    return {
        "role": role,
        "phase": phase,
        "shadow": True,
        "current_tool_count": len(result.current_tools),
        "proposed_tool_count": len(result.proposed_tools),
        "filtered_out_count": len(result.filtered_out),
        "current_tool_names": sorted({_tool_name(tool) for tool in result.current_tools}),
        "proposed_tool_names": [_tool_name(tool) for tool in result.proposed_tools],
        "filtered": [
            {"tool": name, "reason": reason} for name, reason in sorted(result.reason_map.items())
        ],
    }


@dataclass(frozen=True)
class ExposureMode:
    """The resolved T12 exposure posture for one role.

    ``mode`` — ``off`` | ``shadow`` | ``active`` (unrecognized values
    fail safe to ``off``).
    ``role_active`` — ``mode == "active"`` AND the role is inside the
    current rollout stage; only then may the caller serve the filtered
    set.
    """

    mode: str
    role_active: bool


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def _rollout_stage() -> int:
    raw = os.environ.get(ROLLOUT_STAGE_ENV_VAR, "").strip()
    try:
        stage = int(raw) if raw else 0
    except ValueError:
        return 0
    return max(0, stage)


def resolve_exposure_mode(role: str) -> ExposureMode:
    """Resolve the exposure mode + rollout gate for ``role``.

    Never raises, never falls outside the three named modes; anything
    unrecognized (or an unusable stage) fails safe to ``off`` / stage 0.
    """
    raw = os.environ.get(EXPOSURE_MODE_ENV_VAR, "").strip().lower()
    if raw in ("shadow", "active"):
        mode = raw
    elif _env_flag(SHADOW_ENV_VAR):
        mode = "shadow"
    else:
        mode = "off"
    role_active = mode == "active" and role in ROLLOUT_ORDER[: _rollout_stage()]
    return ExposureMode(mode=mode, role_active=role_active)


def active_exposure_tools(role: str, tools: list[Any]) -> list[Any]:
    """Serve the dynamically filtered surface for an active-mode role.

    Never raises and never returns an empty list: any resolution failure
    or empty proposal falls back to the caller's list unchanged — agent
    construction must never break on a UX optimization, and a specialist
    is never left toolless.
    """
    try:
        result = resolve_active_tools(role=role, current_tools=tools)
        proposed = list(result.proposed_tools)
        return proposed if proposed else list(tools)
    except Exception:  # noqa: BLE001 — active exposure must never break agent construction
        logger.debug("active_exposure: resolve failed; serving static", exc_info=True)
        return list(tools)


def _shadow_enabled(role: str) -> bool:
    return _env_flag(SHADOW_ENV_VAR) or resolve_exposure_mode(role).mode != "off"


def record_exposure_shadow(role: str, tools: list[Any]) -> None:
    """Log what dynamic exposure WOULD change for ``role`` — never enforce.

    Logs in every non-``off`` exposure mode (the T9
    ``RAPTIX_EXPOSURE_SHADOW=1`` alias keeps working): shadow mode and
    active mode both need the diff record for ongoing regression
    monitoring. In active mode the served set IS the proposed set of
    this record. Never raises, never mutates ``tools``.
    """
    if not _shadow_enabled(role):
        return
    try:
        result = resolve_active_tools(role=role, current_tools=tools)
        logger.info(
            "exposure_shadow %s",
            json.dumps(summarize_exposure_result(result, role=role, phase=None), default=str),
        )
    except Exception:  # noqa: BLE001 — shadow logging must never break agent construction
        logger.debug("exposure_shadow: record failed", exc_info=True)
