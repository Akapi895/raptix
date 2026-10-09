"""T11 evaluation harness — tool-selection + end-to-end evaluation.

Four evaluation tiers (docs/tool-optimization-implementation-plan.md,
T11), three ablation configs, eight metrics:

=== Tiers ===
* **A — Registry correctness** (no LLM): every scenario-declared
  capability expectation is checked against the real T6
  ``EligibilityEvaluator`` (role, hard phases, AKG requirements from the
  scenario's ``graph_state``) and ``AvailabilityEvaluator`` (executor
  probe from the scenario's ``available_executors``, carrier import
  probe unchanged). Deterministic — computed and reported numerically.
* **B — Tool-selection** (LLM): a ``SelectionPolicy`` picks tools given
  the scenario and a surface; the policy-dependent metrics
  (``selection_precision``, ``invalid_selection_rate``,
  ``unnecessary_tool_calls``, ``bash_fallback_rate``, ``task_success``)
  are scored from the picks. The bundled
  :class:`ScriptedSelectionPolicy` replays each scenario's declared
  ``expected_selection`` — that validates the scoring pipeline only and
  is labeled ``scripted`` in every report. A live-LLM policy plugs into
  the same protocol without reshaping the harness; until one runs, the
  live tier is reported as PENDING, never fabricated.
* **C — Executor** (no LLM): each scenario ``executor_case`` drives the
  real chain request → ``AdapterResolver`` → ``ExecutionSpec`` →
  (canned) artifact → T3 ``ParserRegistry`` → observations, asserting
  argv heads, observation kinds, and the declared hard-error paths.
  Deterministic — computed and reported numerically.
* **D — End-to-end** (LLM): mission → planner → capability → executor →
  AKG → next decision. Requires the live stack; reported as PENDING.

=== Ablation configs ===
* **A — Current Raptix (T0 baseline)**: the pinned
  ``assembled_baseline.jsonl`` per-role surfaces (T0b), in their
  captured order.
* **B — Dynamic tool filtering (same current tools)**: T9's
  ``resolve_active_tools`` applied to config A's names with the
  scenario's phase/graph/executors.
* **C — Capability abstraction**: today's post-T4/T5 static standard
  surface (real tool objects, built through ``build_tools`` with plugin
  discovery pinned off) joined with the T0b middleware names, then the
  same ``resolve_active_tools`` pass.

=== Honesty boundaries ===
* Config A's ``schema_chars`` is the T0a-measured static value; config
  C's is re-measured over its static portion with the SAME shared
  estimator (``raptix.intelligence.agents.tool_exposure``), so the
  static-vs-static comparison never drifts. Middleware tool schemas
  were not captured at T0 and are excluded from BOTH sides — noted in
  every report rather than silently dropped.
* Selection-dependent metrics only ever come from an injected policy.
  No code path in this module invents a selection.
* Held-out fixtures are loaded like any other corpus; thresholds were
  frozen in :mod:`benchmarks.suites.tool_eval.thresholds` BEFORE any held-out
  result was opened.

Run from the repo root::

    uv run python -m benchmarks.suites.tool_eval --fixtures dev
    uv run python -m benchmarks.suites.tool_eval --fixtures held-out --output PATH
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol
from unittest.mock import patch

from benchmarks.engine.paths import new_run_dir
from benchmarks.suites.tool_eval import metrics, thresholds
from benchmarks.suites.tool_eval.scenarios import (
    DEV_FIXTURES,
    HELD_OUT_FIXTURES,
    Scenario,
    load_scenarios,
)

# Plugin discovery pinned off (the capture_baseline.py pattern): module
# imports and build_tools() must stay side-effect-free regardless of the
# caller's ambient environment.
_EVAL_ENV_PIN = {"RAPTIX_PLUGINS": "__tool_eval_evaluation__"}


# ────────────────────────── baseline (config A) ──────────────────────────


def load_assembled_baseline(
    path: str | Path | None = None,
) -> dict[str, tuple[str, ...]]:
    """role → pinned T0b per-turn surface (captured order preserved)."""
    baseline = (
        Path(path)
        if path is not None
        else Path(__file__).parent / "baseline" / "assembled_baseline.jsonl"
    )
    surfaces: dict[str, tuple[str, ...]] = {}
    with baseline.open("r", encoding="utf-8") as handle:
        for raw in handle:
            row = json.loads(raw)
            if row.get("_meta"):
                continue
            role = str(row.get("role") or "")
            if not role:
                continue
            surfaces[role] = tuple(row["final"]["tool_names"])
    if not surfaces:
        raise ValueError(f"{baseline}: no role rows found in the assembled baseline")
    return surfaces


def load_static_baseline_schema_chars(
    path: str | Path | None = None,
) -> dict[str, int]:
    """role → T0a-measured static ``tool_schema_chars`` (shared estimator)."""
    baseline = (
        Path(path) if path is not None else Path(__file__).parent / "baseline" / "baseline.jsonl"
    )
    chars: dict[str, int] = {}
    with baseline.open("r", encoding="utf-8") as handle:
        for raw in handle:
            row = json.loads(raw)
            role = str(row.get("role") or "")
            if role:
                chars[role] = int(row.get("tool_schema_chars") or 0)
    return chars


# ────────────────────── config B/C surfaces (T9 join) ───────────────────


class _NamedTool:
    """Stand-in for a baseline tool name (name-only; no schema object)."""

    __slots__ = ("name",)

    def __init__(self, name: str) -> None:
        self.name = name


def _scenario_executor_probe(available_executors: Sequence[str]) -> Any:  # noqa: ANN401
    """Availability probe from the scenario's declared executor inventory.

    Bare binary names resolve against the declared set (never PATH —
    evaluation must be machine-independent); ``module:attr`` carriers
    keep the real import probe (an in-process tool is importable by
    definition). Mirrors the T9 exposure module's override shape.
    """
    from raptix.capabilities.availability import _probe_executable as _default_probe

    declared = frozenset(available_executors)

    def _probe(executable: str) -> bool:
        if ":" in executable:
            return _default_probe(executable)
        return executable in declared

    return _probe


def _resolve_surface(
    scenario: Scenario,
    current_tools: Sequence[Any],
    *,
    registry: Any = None,  # noqa: ANN401 — CapabilityRegistry, injected for tests
) -> tuple[tuple[str, ...], Any]:
    """Run T9 ``resolve_active_tools`` for one scenario; returns (names, result)."""
    from raptix.capabilities import CapabilityRegistry
    from raptix.intelligence.tooling.exposure import GraphSnapshot, resolve_active_tools

    result = resolve_active_tools(
        role=scenario.role,
        phase=scenario.phase,
        graph_state=GraphSnapshot(requirement_results=dict(scenario.graph_state)),
        available_executors=tuple(scenario.available_executors),
        current_tools=list(current_tools),
        registry=registry if registry is not None else CapabilityRegistry(),
    )
    return tuple(tool.name for tool in result.proposed_tools), result


def config_b_surface(
    scenario: Scenario,
    baseline_surfaces: dict[str, tuple[str, ...]],
    *,
    registry: Any = None,  # noqa: ANN401
) -> tuple[str, ...]:
    """Config B — dynamic filtering over the pinned T0 baseline surface."""
    baseline = baseline_surfaces.get(scenario.role, ())
    names, _result = _resolve_surface(
        scenario, [_NamedTool(name) for name in baseline], registry=registry
    )
    return names


def today_static_tools(role: str) -> tuple[tuple[Any, ...], str]:
    """Today's post-T4/T5 static surface for ``role`` as real tool objects.

    Mirrors the T0a capture machinery exactly (module import + patched
    entry points + ``build_tools``), so config C's static layer is the
    same object today's agents serve — never a reimplementation.
    """
    module_name = f"raptix.intelligence.agents.standard.{role}"
    with patch.dict(os.environ, _EVAL_ENV_PIN):
        from raptix.intelligence.agents import build as build_module
        from raptix_core import plugin_loader

        with (
            patch.object(build_module, "entry_points", return_value=[]),
            patch.object(plugin_loader, "entry_points", return_value=[]),
        ):
            module = importlib.import_module(module_name)
            standard_tools = dict(module._STANDARD_TOOLS)  # noqa: SLF001 — the capture contract
            tools = build_module.build_tools(role=module._ROLE, standard_tools=standard_tools)  # noqa: SLF001
    return tuple(tools), module_name


def catalog_eligible_tools(
    scenario: Scenario,
    *,
    registry: Any = None,  # noqa: ANN401
) -> tuple[Any, ...]:
    """Real carrier tool objects for every catalog capability that is
    BOTH eligible for the scenario's role/phase/requirements AND
    technically available under the scenario's executor inventory.

    This is the capability-abstraction promise made concrete: the
    surface is driven by the catalog, not by whether a wiring list
    happened to name the tool. Deduplicated by tool name (first
    manifest wins, mirroring the T9 index).
    """
    from raptix.capabilities import (
        AvailabilityEvaluator,
        CapabilityRegistry,
        EligibilityEvaluator,
    )
    from raptix_core.types.capability import CapabilityStatus, ImplementationKind

    registry = registry if registry is not None else CapabilityRegistry()
    availability = AvailabilityEvaluator(
        executable_probe=_scenario_executor_probe(scenario.available_executors)
    )
    eligibility = EligibilityEvaluator(requirement_evaluator=_graph_answers(scenario.graph_state))
    tools: list[Any] = []
    seen: set[str] = set()
    for manifest in registry:
        if not eligibility.evaluate(manifest, role=scenario.role, phase=scenario.phase).eligible:
            continue
        if availability.evaluate(manifest).status is CapabilityStatus.UNAVAILABLE:
            continue
        for implementation in manifest.implementations:
            if implementation.kind is not ImplementationKind.ADAPTER:
                continue
            executable = implementation.executable or ""
            if ":" not in executable:
                continue
            module_name, _, attr = executable.partition(":")
            module = importlib.import_module(module_name)
            obj = getattr(module, attr, None)
            name = getattr(obj, "name", None)
            if obj is None or not isinstance(name, str) or not name or name in seen:
                continue
            seen.add(name)
            tools.append(obj)
    return tuple(tools)


def config_c_surface(
    scenario: Scenario,
    baseline_surfaces: dict[str, tuple[str, ...]],
    *,
    static_tools: Sequence[Any] | None = None,
    registry: Any = None,  # noqa: ANN401
) -> tuple[tuple[str, ...], tuple[Any, ...]]:
    """Config C — capability abstraction surface.

    Today's static standard tools (real objects), COMPLETED with every
    eligible catalog capability tool not already wired (the T6 promise:
    the catalog, not a wiring list, decides what the role can do),
    joined with the T0b middleware names, then dynamically resolved by
    T9. Returns (proposed names, the real tool objects that survived)
    — the latter for schema measurement with the shared estimator.
    """
    if static_tools is None:
        static_tools, _module = today_static_tools(scenario.role)
    catalog = catalog_eligible_tools(scenario, registry=registry)
    existing = {tool.name for tool in static_tools}
    catalog_extras = [tool for tool in catalog if tool.name not in existing]
    middleware = baseline_surfaces.get(scenario.role, ())
    middleware_only = [_NamedTool(name) for name in middleware if name not in existing]
    names, _result = _resolve_surface(
        scenario, [*static_tools, *catalog_extras, *middleware_only], registry=registry
    )
    kept = tuple(tool for tool in (*static_tools, *catalog_extras) if tool.name in set(names))
    return names, kept


# ────────────────────────────── Tier A ──────────────────────────────


@dataclass(frozen=True)
class TierACase:
    scenario_id: str
    capability_id: str
    expectation: str
    passed: bool
    detail: str


def _graph_answers(graph_state: dict[str, bool]) -> Any:  # noqa: ANN401
    """Adapt the scenario's requirement answers to the runtime protocol."""
    from raptix_core.types.capability import RequirementSpec

    class _Answers:
        def check(self, requirement: RequirementSpec) -> bool:
            return bool(graph_state.get(requirement.id, False))

    return _Answers()


def run_tier_a(
    scenarios: Sequence[Scenario],
    *,
    registry: Any = None,  # noqa: ANN401
) -> dict[str, Any]:
    """Tier A — registry correctness: eligibility + availability truth."""
    from raptix.capabilities import (
        AvailabilityEvaluator,
        CapabilityRegistry,
        EligibilityEvaluator,
    )

    registry = registry if registry is not None else CapabilityRegistry()
    cases: list[TierACase] = []
    for scenario in scenarios:
        availability = AvailabilityEvaluator(
            executable_probe=_scenario_executor_probe(scenario.available_executors)
        )
        eligibility = EligibilityEvaluator(
            requirement_evaluator=_graph_answers(scenario.graph_state)
        )
        for capability_id, expectation in sorted(scenario.capability_expectations.items()):
            try:
                manifest = registry.get(capability_id)
            except LookupError as error:
                cases.append(
                    TierACase(scenario.scenario_id, capability_id, expectation, False, str(error))
                )
                continue
            verdict = eligibility.evaluate(manifest, role=scenario.role, phase=scenario.phase)
            status = availability.evaluate(manifest).status
            if expectation == "eligible":
                passed, detail = verdict.eligible, verdict.reason or "eligible"
            elif expectation == "ineligible":
                passed, detail = not verdict.eligible, verdict.reason or "eligible"
            elif expectation == "available":
                passed = verdict.eligible and status.value == "available"
                detail = f"eligible={verdict.eligible} status={status.value}"
            else:  # "unavailable"
                passed, detail = status.value == "unavailable", f"status={status.value}"
            cases.append(
                TierACase(scenario.scenario_id, capability_id, expectation, passed, detail)
            )
    passed_count = sum(1 for case in cases if case.passed)
    return {
        "tier": "A",
        "kind": "registry correctness",
        "llm_required": False,
        "cases": [case.__dict__ for case in cases],
        "pass_rate": passed_count / len(cases) if cases else 1.0,
        "meets_threshold": (passed_count / len(cases) if cases else 1.0)
        >= thresholds.TIER_A_PASS_RATE_MIN,
    }


# ────────────────────────────── Tier C ──────────────────────────────


@dataclass(frozen=True)
class TierCCase:
    scenario_id: str
    case_id: str
    capability_id: str
    passed: bool
    detail: str


def run_tier_c(scenarios: Sequence[Scenario]) -> dict[str, Any]:
    """Tier C — executor chain: adapter → spec → artifact → parser."""
    from raptix.execution.adapters import AdapterResolutionError, AdapterResolver
    from raptix.capabilities import AvailabilityEvaluator, CapabilityRegistry
    from raptix.knowledge.ingest.registry import (
        ParseError,
        default_registry,
        iter_node_observations,
    )
    from raptix_core.types.capability import (
        Artifact,
        CapabilityRequest,
        ExecutorKind,
    )

    cases: list[TierCCase] = []
    for scenario in scenarios:
        if not scenario.executor_cases:
            continue
        availability = AvailabilityEvaluator(
            executable_probe=_scenario_executor_probe(scenario.available_executors)
        )
        registry = CapabilityRegistry(availability=availability)
        resolver = AdapterResolver(registry, availability=availability)
        parsers = default_registry()
        for case in scenario.executor_cases:
            request = CapabilityRequest(
                capability_id=case.capability_id,
                parameters=dict(case.parameters),
                context={},
            )
            try:
                spec = resolver.resolve(request)
            except (AdapterResolutionError, LookupError) as error:
                passed = case.expect_resolution_error
                cases.append(
                    TierCCase(
                        scenario.scenario_id,
                        case.case_id,
                        case.capability_id,
                        passed,
                        f"resolution: {error}" if passed else f"unexpected: {error}",
                    )
                )
                continue
            if case.expect_resolution_error:
                cases.append(
                    TierCCase(
                        scenario.scenario_id,
                        case.case_id,
                        case.capability_id,
                        False,
                        f"expected resolution error, got argv={spec.payload.get('argv')!r}",
                    )
                )
                continue
            checks: list[tuple[bool, str]] = [
                (spec.executor_kind is ExecutorKind.COMMAND, f"executor_kind={spec.executor_kind}")
            ]
            argv_raw = spec.payload.get("argv")
            argv = [str(part) for part in (argv_raw if isinstance(argv_raw, list) else ())]
            head_ok = tuple(argv[: len(case.expected_argv_head)]) == tuple(case.expected_argv_head)
            checks.append((head_ok, f"argv head {argv[: len(case.expected_argv_head)]!r}"))
            if all(ok for ok, _detail in checks) and (case.content or case.expect_parse_error):
                artifact = Artifact(
                    id=f"{scenario.scenario_id}-{case.case_id}",
                    artifact_ref=f"artifact://tool-eval/{scenario.scenario_id}/{case.case_id}",
                    format_hint=(spec.expected_artifact_formats or (None,))[0],
                    producer=spec.executor_id,
                    metadata=dict(case.artifact_metadata),
                )
                try:
                    outcome = parsers.parse(
                        artifact,
                        case.content.encode("utf-8"),
                        expected_formats=tuple(spec.expected_artifact_formats),
                    )
                except (ParseError, ValueError) as error:
                    checks.append((case.expect_parse_error, f"parse: {error}"))
                else:
                    kinds = sorted(
                        {
                            observation.kind
                            for observation in iter_node_observations(outcome.observations)
                        }
                    )
                    checks.append(
                        (
                            not case.expect_parse_error and set(case.expected_kinds) <= set(kinds),
                            f"kinds={kinds}",
                        )
                    )
            passed = all(ok for ok, _detail in checks)
            detail = "; ".join(detail for ok, detail in checks if not ok) or "ok"
            cases.append(
                TierCCase(scenario.scenario_id, case.case_id, case.capability_id, passed, detail)
            )
    passed_count = sum(1 for case in cases if case.passed)
    return {
        "tier": "C",
        "kind": "executor chain",
        "llm_required": False,
        "cases": [case.__dict__ for case in cases],
        "pass_rate": passed_count / len(cases) if cases else 1.0,
        "meets_threshold": (passed_count / len(cases) if cases else 1.0)
        >= thresholds.TIER_C_PASS_RATE_MIN,
    }


# ────────────────────────── Tier B (policy) ──────────────────────────


class SelectionPolicy(Protocol):
    """Pluggable tool-selection policy (live-LLM implementations plug in here).

    ``live`` marks whether the policy queries a real model: scripted
    reference policies set ``live = False`` and their numbers are
    labeled pipeline-validation only.
    """

    name: str
    live: bool

    def select(self, scenario: Scenario, surface: Sequence[str]) -> tuple[str, ...]: ...


class ScriptedSelectionPolicy:
    """Replays each scenario's declared ``expected_selection``.

    Pipeline validation only — the numbers it produces measure the
    scoring plumbing, never model behavior. Reports mark this policy
    ``scripted``.
    """

    name = "scripted"
    live = False

    def select(self, scenario: Scenario, surface: Sequence[str]) -> tuple[str, ...]:
        picks = scenario.expected_selection or scenario.required_tools
        return tuple(pick for pick in picks if pick in set(surface))


@dataclass(frozen=True)
class TierBCase:
    scenario_id: str
    selected: tuple[str, ...]
    selection_precision: float | None
    invalid_selection_rate: float | None
    unnecessary_tool_calls: int
    bash_fallback_rate: float | None
    task_success: bool


def run_tier_b(
    scenarios: Sequence[Scenario],
    policy: SelectionPolicy,
    *,
    surface_builder: Any = None,  # noqa: ANN401 — callable(scenario) → tuple[str, ...]
) -> dict[str, Any]:
    """Tier B — score one policy's selections per scenario."""
    builder = surface_builder or (
        lambda scenario: config_b_surface(scenario, load_assembled_baseline())
    )
    cases: list[TierBCase] = []
    for scenario in scenarios:
        surface = builder(scenario)
        selected = policy.select(scenario, surface)
        # The scored call sequence is the selection order itself: the
        # deterministic tier has no transcript; a live-LLM policy would
        # score its actual tool-call log here instead.
        cases.append(
            TierBCase(
                scenario.scenario_id,
                selected,
                metrics.selection_precision(
                    selected, scenario.required_tools, scenario.optional_tools
                ),
                metrics.invalid_selection_rate(selected, scenario.forbidden_tools),
                metrics.unnecessary_tool_calls(
                    selected, scenario.required_tools, scenario.optional_tools
                ),
                metrics.bash_fallback_rate(selected),
                metrics.task_success(selected, scenario.required_tools, scenario.forbidden_tools),
            )
        )
    precisions = [
        case.selection_precision for case in cases if case.selection_precision is not None
    ]
    invalids = [
        case.invalid_selection_rate for case in cases if case.invalid_selection_rate is not None
    ]
    successes = [case.task_success for case in cases]
    precision_mean = sum(precisions) / len(precisions) if precisions else None
    invalid_mean = sum(invalids) / len(invalids) if invalids else None
    success_rate = sum(successes) / len(successes) if successes else None
    live_capable = bool(getattr(policy, "live", True))
    return {
        "tier": "B",
        "kind": "tool-selection",
        "llm_required": True,
        "policy": policy.name,
        "mode": "live" if live_capable else "scripted (pipeline validation only)",
        "cases": [
            {
                "scenario_id": case.scenario_id,
                "selected": list(case.selected),
                "selection_precision": case.selection_precision,
                "invalid_selection_rate": case.invalid_selection_rate,
                "unnecessary_tool_calls": case.unnecessary_tool_calls,
                "bash_fallback_rate": case.bash_fallback_rate,
                "task_success": case.task_success,
            }
            for case in cases
        ],
        "selection_precision": precision_mean,
        "invalid_selection_rate": invalid_mean,
        "task_success_rate": success_rate,
        "pending_live_run": not live_capable,
        "meets_threshold": (
            precision_mean is not None
            and precision_mean >= thresholds.SELECTION_PRECISION_MIN
            and (invalid_mean is None or invalid_mean <= thresholds.INVALID_SELECTION_RATE_MAX)
            and success_rate is not None
            and success_rate >= thresholds.TASK_SUCCESS_RATE_MIN
        )
        if live_capable
        else None,
    }


# ──────────────────── exposure comparison + report ────────────────────


def _schema_chars(tools: Sequence[Any]) -> int:
    from raptix.intelligence.agents.tool_exposure import _schema_char_estimate

    return sum(_schema_char_estimate(tool) for tool in tools)


@dataclass(frozen=True)
class ExposureRow:
    scenario_id: str
    role: str
    config: str
    surface_size: int
    capability_exposure_recall: float
    forbidden_exposure_rate: float
    discovery_latency: int | None
    task_success_proxy: bool
    schema_chars: int | None


def exposure_comparison(
    scenarios: Sequence[Scenario],
    *,
    baseline_surfaces: dict[str, tuple[str, ...]] | None = None,
    static_schema_chars: dict[str, int] | None = None,
    registry: Any = None,  # noqa: ANN401
) -> list[ExposureRow]:
    """Compute the LLM-free exposure metrics for configs A, B, C per scenario."""
    baseline_surfaces = (
        baseline_surfaces if baseline_surfaces is not None else load_assembled_baseline()
    )
    static_schema_chars = (
        static_schema_chars
        if static_schema_chars is not None
        else load_static_baseline_schema_chars()
    )
    today_cache: dict[str, tuple[Any, ...]] = {}
    rows: list[ExposureRow] = []
    for scenario in scenarios:
        required = tuple(scenario.required_tools)
        forbidden = tuple(scenario.forbidden_tools)

        surface_a = baseline_surfaces.get(scenario.role, ())
        recall_a = metrics.capability_exposure_recall(surface_a, required)
        forbidden_a = metrics.forbidden_exposure_rate(surface_a, forbidden)
        rows.append(
            ExposureRow(
                scenario.scenario_id,
                scenario.role,
                "A",
                len(surface_a),
                recall_a,
                forbidden_a,
                metrics.discovery_latency(surface_a, required),
                recall_a == 1.0 and forbidden_a == 0.0,
                static_schema_chars.get(scenario.role),
            )
        )

        surface_b = config_b_surface(scenario, baseline_surfaces, registry=registry)
        recall_b = metrics.capability_exposure_recall(surface_b, required)
        forbidden_b = metrics.forbidden_exposure_rate(surface_b, forbidden)
        rows.append(
            ExposureRow(
                scenario.scenario_id,
                scenario.role,
                "B",
                len(surface_b),
                recall_b,
                forbidden_b,
                metrics.discovery_latency(surface_b, required),
                recall_b == 1.0 and forbidden_b == 0.0,
                static_schema_chars.get(scenario.role),
            )
        )

        if scenario.role not in today_cache:
            today_cache[scenario.role], _module = today_static_tools(scenario.role)
        surface_c, kept_static = config_c_surface(
            scenario, baseline_surfaces, static_tools=today_cache[scenario.role], registry=registry
        )
        recall_c = metrics.capability_exposure_recall(surface_c, required)
        forbidden_c = metrics.forbidden_exposure_rate(surface_c, forbidden)
        rows.append(
            ExposureRow(
                scenario.scenario_id,
                scenario.role,
                "C",
                len(surface_c),
                recall_c,
                forbidden_c,
                metrics.discovery_latency(surface_c, required),
                recall_c == 1.0 and forbidden_c == 0.0,
                _schema_chars(kept_static),
            )
        )
    return rows


def _per_config_summary(rows: Sequence[ExposureRow]) -> dict[str, dict[str, Any]]:
    """Aggregate the exposure rows per ablation config.

    Config A's floors are reported as baseline-completeness facts, never
    gated: the T0 baseline predates T4–T10, so scenarios exercising
    post-T0 capabilities legitimately measure A's recall below 1.0 —
    that gap IS the improvement evidence. The frozen gates apply to the
    NEW configs (B, C).
    """
    summary: dict[str, dict[str, Any]] = {}
    for config in ("A", "B", "C"):
        config_rows = [row for row in rows if row.config == config]
        if not config_rows:
            continue
        latencies = [
            row.discovery_latency for row in config_rows if row.discovery_latency is not None
        ]
        summary[config] = {
            "surface_size_max": max(row.surface_size for row in config_rows),
            "capability_exposure_recall_min": min(
                row.capability_exposure_recall for row in config_rows
            ),
            "forbidden_exposure_rate_max": max(row.forbidden_exposure_rate for row in config_rows),
            "task_success_proxy": sum(1 for row in config_rows if row.task_success_proxy)
            / len(config_rows),
            "discovery_latency_max": max(latencies) if latencies else 0,
            "schema_chars_min": min(
                row.schema_chars for row in config_rows if row.schema_chars is not None
            ),
            "schema_chars_max": max(
                row.schema_chars for row in config_rows if row.schema_chars is not None
            ),
        }
    return summary


def _gates(
    per_config: dict[str, dict[str, Any]],
    rows: Sequence[ExposureRow],
) -> dict[str, Any]:
    """The frozen T11 gates, evaluated against the per-config aggregates."""
    recall_by_scenario: dict[str, dict[str, float]] = {}
    for row in rows:
        recall_by_scenario.setdefault(row.scenario_id, {})[row.config] = (
            row.capability_exposure_recall
        )
    non_regression_failures = [
        {
            "scenario_id": scenario_id,
            "config": config,
            "recall": recalls[config],
            "baseline": recalls["A"],
        }
        for scenario_id, recalls in recall_by_scenario.items()
        for config in ("B", "C")
        if recalls[config] < recalls["A"] - 0.05
    ]
    b_summary = per_config.get("B", {})
    c_summary = per_config.get("C", {})

    def _new_config_gates(summary: dict[str, Any]) -> dict[str, Any]:
        return {
            "capability_exposure_recall_min": summary.get("capability_exposure_recall_min"),
            "recall_ok": summary.get("capability_exposure_recall_min", 0.0)
            >= thresholds.CAPABILITY_EXPOSURE_RECALL_MIN,
            "forbidden_ok": summary.get("forbidden_exposure_rate_max", 1.0)
            <= thresholds.FORBIDDEN_EXPOSURE_RATE_MAX,
            "success_proxy_ok": summary.get("task_success_proxy", 0.0)
            >= thresholds.TASK_SUCCESS_PROXY_MIN,
            "latency_ok": summary.get("discovery_latency_max", 10**6)
            <= thresholds.DISCOVERY_LATENCY_MAX,
        }

    b_gates = _new_config_gates(b_summary)
    c_gates = _new_config_gates(c_summary)
    # Config B only ever FILTERS config A's surface — it structurally
    # cannot expose a capability the T0 baseline lacked, so B's absolute
    # recall/success floors are inherited from A and reported, not gated.
    # B's gates are the exposure-safety pair; its recall/success
    # non-regression vs A is the ``non_regression`` block above. The
    # frozen absolute floors gate config C — the target architecture.
    b_gates["recall_ok"] = None
    b_gates["success_proxy_ok"] = None
    b_gates["latency_ok"] = None
    b_gates["note"] = (
        "B filters A's pinned surface; recall/success/latency floors are inherited "
        "from A and gated via non_regression instead"
    )
    return {
        "non_regression": {
            "failures": non_regression_failures,
            "ok": not non_regression_failures,
            "rule": "recall(config) >= recall(A) - 0.05 for every scenario",
        },
        "config_B": b_gates,
        "config_C": c_gates,
        "ok": (
            b_gates["forbidden_ok"]
            and c_gates["recall_ok"]
            and c_gates["forbidden_ok"]
            and c_gates["success_proxy_ok"]
            and c_gates["latency_ok"]
            and not non_regression_failures
        ),
    }


def evaluate(
    fixtures: str | Path = DEV_FIXTURES,
    *,
    tier_b_policy: SelectionPolicy | None = None,
) -> dict[str, Any]:
    """Run the full deterministic evaluation over one fixture corpus."""
    scenarios = load_scenarios(fixtures)
    tier_a = run_tier_a(scenarios)
    tier_c = run_tier_c(scenarios)
    tier_b = run_tier_b(scenarios, tier_b_policy or ScriptedSelectionPolicy())
    rows = exposure_comparison(scenarios)
    per_config = _per_config_summary(rows)
    gates = _gates(per_config, rows)
    return {
        "fixtures": str(fixtures),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "thresholds_frozen_at": thresholds.FROZEN_AT,
        "scenario_count": len(scenarios),
        "tiers": {
            "A": tier_a,
            "B": tier_b,
            "C": tier_c,
            "D": {
                "tier": "D",
                "kind": "end-to-end",
                "llm_required": True,
                "pending_live_run": True,
                "note": "requires the live stack (mission → planner → worker → executor → AKG)",
            },
        },
        "exposure_comparison": [row.__dict__ for row in rows],
        "per_config": per_config,
        "gates": gates,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="benchmarks.suites.tool_eval",
        description="T11 tool-selection + end-to-end evaluation harness.",
    )
    parser.add_argument(
        "--fixtures",
        default="dev",
        help="dev | held-out | path to a scenario .jsonl corpus",
    )
    parser.add_argument("--output", default=None, help="write the JSON report here")
    args = parser.parse_args(argv)

    if args.fixtures == "dev":
        fixtures: str | Path = DEV_FIXTURES
    elif args.fixtures == "held-out":
        fixtures = HELD_OUT_FIXTURES
    else:
        fixtures = args.fixtures

    report = evaluate(fixtures)
    rendered = json.dumps(report, indent=2, default=str)

    output = Path(args.output) if args.output else None
    if output is None:
        output = new_run_dir("tool-eval") / "report.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered + "\n", encoding="utf-8")

    print(f"fixtures: {report['fixtures']}  scenarios: {report['scenario_count']}")
    print(
        f"tier A pass_rate={report['tiers']['A']['pass_rate']:.3f}  "
        f"tier C pass_rate={report['tiers']['C']['pass_rate']:.3f}"
    )
    print(f"tier B policy={report['tiers']['B']['policy']} mode={report['tiers']['B']['mode']}")
    for config, summary in report["per_config"].items():
        print(
            f"config {config}: size<={summary['surface_size_max']} "
            f"recall_min={summary['capability_exposure_recall_min']:.3f} "
            f"forbidden_max={summary['forbidden_exposure_rate_max']:.3f} "
            f"success_proxy={summary['task_success_proxy']:.3f} "
            f"latency_max={summary['discovery_latency_max']} "
            f"schema_chars=[{summary['schema_chars_min']}..{summary['schema_chars_max']}]"
        )
    print(f"gates: ok={report['gates']['ok']}  report: {output}")
    return 0 if report["gates"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
