"""Deterministic tests for the Wave T11 tool-eval harness.

No LLM, no network: tiers A/C run the real registry/adapters/parsers
over the frozen fixture corpora, the exposure comparison joins the
pinned T0 baseline artifacts, and tier B runs only the scripted
reference policy (pipeline validation — never model behavior).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import pytest

from benchmarks.suites.tool_eval import metrics, thresholds
from benchmarks.suites.tool_eval.evaluate import (
    config_b_surface,
    exposure_comparison,
    load_assembled_baseline,
    load_static_baseline_schema_chars,
    run_tier_a,
    run_tier_b,
    run_tier_c,
    today_static_tools,
)
from benchmarks.suites.tool_eval.scenarios import (
    DEV_FIXTURES,
    HELD_OUT_FIXTURES,
    Scenario,
    load_scenarios,
)

FIXTURES = {"dev": DEV_FIXTURES, "held-out": HELD_OUT_FIXTURES}


# ────────────────────────── loader strictness ──────────────────────────


class TestLoader:
    @pytest.mark.parametrize("name", sorted(FIXTURES))
    def test_real_corpora_load_and_are_unique(self, name: str) -> None:
        scenarios = load_scenarios(FIXTURES[name])
        assert len(scenarios) >= 4
        assert len({s.scenario_id for s in scenarios}) == len(scenarios)

    def test_unknown_field_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "s.jsonl"
        payload = {
            "scenario_id": "x",
            "role": "recon",
            "mission": "m",
            "required_tools": ["web_search"],
            "surprise_field": True,
        }
        path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        with pytest.raises(ValueError, match="surprise_field"):
            load_scenarios(path)

    def test_duplicate_ids_are_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "s.jsonl"
        payload = {
            "scenario_id": "x",
            "role": "recon",
            "mission": "m",
            "required_tools": ["web_search"],
        }
        path.write_text(json.dumps(payload) + "\n" + json.dumps(payload) + "\n", encoding="utf-8")
        with pytest.raises(ValueError, match="duplicate scenario_id"):
            load_scenarios(path)

    @pytest.mark.parametrize(
        ("required", "forbidden", "optional"),
        [
            (["bash"], ["bash"], []),
            (["bash"], [], ["bash"]),
            (["bash"], ["web_search"], ["web_search"]),
        ],
    )
    def test_set_overlaps_are_rejected(
        self, tmp_path: Path, required: list[str], forbidden: list[str], optional: list[str]
    ) -> None:
        path = tmp_path / "s.jsonl"
        payload = {
            "scenario_id": "x",
            "role": "recon",
            "mission": "m",
            "required_tools": required,
            "forbidden_tools": forbidden,
            "optional_tools": optional,
        }
        path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        with pytest.raises(ValueError, match="∩"):
            load_scenarios(path)

    def test_unknown_expectation_value_is_rejected(self, tmp_path: Path) -> None:
        path = tmp_path / "s.jsonl"
        payload = {
            "scenario_id": "x",
            "role": "recon",
            "mission": "m",
            "required_tools": ["bash"],
            "capability_expectations": {"network.scan": "maybe"},
        }
        path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        with pytest.raises(ValueError, match="unknown expectation values"):
            load_scenarios(path)

    def test_expected_selection_may_not_pick_forbidden_tools(self, tmp_path: Path) -> None:
        path = tmp_path / "s.jsonl"
        payload = {
            "scenario_id": "x",
            "role": "recon",
            "mission": "m",
            "required_tools": ["bash"],
            "forbidden_tools": ["web_search"],
            "expected_selection": ["web_search"],
        }
        path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        with pytest.raises(ValueError, match="expected_selection"):
            load_scenarios(path)


# ────────────────────────────── metrics ──────────────────────────────


class TestMetrics:
    def test_selection_precision_counts_optional_as_value(self) -> None:
        assert metrics.selection_precision(["a", "z"], ["a"], ["b"]) == 0.5
        assert metrics.selection_precision([], ["a"], []) is None

    def test_invalid_selection_rate(self) -> None:
        assert metrics.invalid_selection_rate(["a", "f", "f"], ["f"]) == 2 / 3
        assert metrics.invalid_selection_rate([], ["f"]) is None

    def test_unnecessary_tool_calls_counts_duplicates_outside_value(self) -> None:
        assert metrics.unnecessary_tool_calls(["a", "x", "x"], ["a"], ["b"]) == 2

    def test_bash_fallback_rate(self) -> None:
        assert metrics.bash_fallback_rate(["bash", "nmap"]) == 0.5
        assert metrics.bash_fallback_rate([]) is None

    def test_task_success_requires_all_required_and_no_forbidden(self) -> None:
        assert metrics.task_success(["a", "b"], ["a"], ["z"]) is True
        assert metrics.task_success(["a"], ["a", "b"], []) is False
        assert metrics.task_success(["a", "z"], ["a"], ["z"]) is False

    def test_exposure_recall_and_forbidden_rate(self) -> None:
        assert metrics.capability_exposure_recall(["a"], ["a", "b"]) == 0.5
        assert metrics.capability_exposure_recall(["a"], []) == 1.0
        assert metrics.forbidden_exposure_rate(["a", "f"], ["f", "g"]) == 0.5
        assert metrics.forbidden_exposure_rate(["a"], []) == 0.0

    def test_discovery_latency_first_required_position_or_none(self) -> None:
        assert metrics.discovery_latency(["x", "y", "a"], ["a"]) == 2
        assert metrics.discovery_latency(["x"], ["a"]) is None


# ──────────────────────────── thresholds ────────────────────────────


class TestFrozenThresholds:
    def test_frozen_values_are_pinned(self) -> None:
        assert thresholds.FROZEN_AT == "2026-10-07"
        assert thresholds.TIER_A_PASS_RATE_MIN == 1.0
        assert thresholds.TIER_C_PASS_RATE_MIN == 1.0
        assert thresholds.CAPABILITY_EXPOSURE_RECALL_MIN == 0.95
        assert thresholds.FORBIDDEN_EXPOSURE_RATE_MAX == 0.0
        assert thresholds.DISCOVERY_LATENCY_MAX == 5
        assert thresholds.TASK_SUCCESS_PROXY_MIN == 0.90
        assert thresholds.SELECTION_PRECISION_MIN == 0.75
        assert thresholds.INVALID_SELECTION_RATE_MAX == 0.10
        assert thresholds.TASK_SUCCESS_RATE_MIN == 0.90
        assert thresholds.BASH_FALLBACK_RATE_MAX == 0.20
        assert thresholds.SCHEMA_REDUCTION_RATIO_MIN == 0.20


# ─────────────────────── baseline (config A) ───────────────────────


class TestBaselineSurfaces:
    def test_assembled_baseline_loads_pinned_roles_in_captured_order(self) -> None:
        surfaces = load_assembled_baseline()
        assert set(surfaces) >= {"recon", "exploit", "analyst", "blue_cell", "osint_operator"}
        assert surfaces["blue_cell"][0] == "blue_cell_scan"

    def test_static_baseline_schema_chars_load(self) -> None:
        chars = load_static_baseline_schema_chars()
        assert chars["analyst"] > 0


# ────────────────────────────── Tier A ──────────────────────────────


class TestTierA:
    @pytest.mark.parametrize("name", sorted(FIXTURES))
    def test_every_expectation_matches_the_real_registry(self, name: str) -> None:
        result = run_tier_a(load_scenarios(FIXTURES[name]))
        assert result["pass_rate"] == 1.0, [c for c in result["cases"] if not c["passed"]]
        assert result["meets_threshold"] is True

    def test_a_wrong_expectation_fails_the_case(self) -> None:
        scenario = Scenario.model_validate(
            {
                "scenario_id": "wrong",
                "role": "recon",
                "mission": "m",
                "required_tools": ["bash"],
                "capability_expectations": {"defense.scan_coverage": "available"},
            }
        )
        result = run_tier_a([scenario])
        assert result["pass_rate"] == 0.0
        assert result["cases"][0]["passed"] is False


# ────────────────────────────── Tier C ──────────────────────────────


class TestTierC:
    @pytest.mark.parametrize("name", sorted(FIXTURES))
    def test_every_executor_case_drives_the_real_chain(self, name: str) -> None:
        result = run_tier_c(load_scenarios(FIXTURES[name]))
        assert result["cases"], "fixtures must exercise the executor chain"
        assert result["pass_rate"] == 1.0, [c for c in result["cases"] if not c["passed"]]
        assert result["meets_threshold"] is True

    def test_resolution_error_is_pinned_when_declared(self) -> None:
        scenarios = load_scenarios(FIXTURES["dev"])
        result = run_tier_c(scenarios)
        pinned = [c for c in result["cases"] if c["case_id"] == "responder-not-declared"]
        assert len(pinned) == 1
        assert pinned[0]["passed"] is True


# ─────────────────────── exposure comparison ───────────────────────


class TestExposureComparison:
    @pytest.mark.parametrize("name", sorted(FIXTURES))
    def test_configs_b_and_c_never_expose_forbidden_tools(self, name: str) -> None:
        rows = exposure_comparison(load_scenarios(FIXTURES[name]))
        assert all(row.forbidden_exposure_rate == 0.0 for row in rows)

    def test_config_c_completes_the_surface_from_the_catalog(self) -> None:
        scenarios = load_scenarios(FIXTURES["dev"])
        tech_stack = next(s for s in scenarios if s.scenario_id == "recon-tech-stack")
        rows = [row for row in exposure_comparison([tech_stack]) if row.config == "C"]
        assert rows[0].capability_exposure_recall == 1.0

    def test_config_b_preserves_the_baseline_surface_order(self) -> None:
        scenarios = load_scenarios(FIXTURES["dev"])
        baseline = load_assembled_baseline()
        for scenario in scenarios[:2]:
            surface = config_b_surface(scenario, baseline)
            pinned = set(baseline[scenario.role])
            assert set(surface) <= pinned

    def test_today_static_tools_returns_real_objects(self) -> None:
        tools, module = today_static_tools("recon")
        assert "raptix.intelligence.agents.standard.recon" == module
        names = {tool.name for tool in tools}
        assert {"bash", "web_fetch", "web_search"} <= names
        assert all(getattr(tool, "description", None) for tool in tools)


# ────────────────────────────── Tier B ──────────────────────────────


class TestTierB:
    def test_scripted_policy_scores_perfect_selection(self) -> None:
        from benchmarks.suites.tool_eval.evaluate import ScriptedSelectionPolicy

        scenarios = load_scenarios(FIXTURES["dev"])
        result = run_tier_b(scenarios, ScriptedSelectionPolicy())
        assert result["mode"].startswith("scripted")
        assert result["pending_live_run"] is True
        assert result["meets_threshold"] is None
        by_id = {case["scenario_id"]: case for case in result["cases"]}
        # Config B structurally inherits A's gaps: the scripted answer for
        # recon-tech-stack (detect_tech_stack) is not exposed by the T0
        # surface, so the scored selection is honestly empty there.
        assert by_id["recon-tech-stack"]["selected"] == []
        assert by_id["recon-tech-stack"]["task_success"] is False
        for case in result["cases"]:
            if case["selected"]:
                assert case["invalid_selection_rate"] == 0.0
                assert case["unnecessary_tool_calls"] == 0
        # analyst-reporting: generate_report is not in the T0 surface, so
        # even the scripted answer degrades to a partial selection there.
        assert by_id["analyst-reporting"]["task_success"] is False
        assert by_id["exploit-lateral-move"]["task_success"] is True

    def test_a_policy_that_picks_forbidden_tools_is_scored_negatively(self) -> None:
        from benchmarks.suites.tool_eval.evaluate import ScriptedSelectionPolicy

        class ForbiddenPolicy(ScriptedSelectionPolicy):
            name = "forbidden"

            def select(self, scenario: Scenario, surface: Sequence[str]) -> tuple[str, ...]:
                return (scenario.forbidden_tools[0],) if scenario.forbidden_tools else ()

        # A surface that exposes every required AND forbidden tool, so the
        # scoring math — not surface availability — is what's under test.
        surface_builder = lambda scenario: (  # noqa: E731 — test-local builder
            tuple(scenario.required_tools) + tuple(scenario.forbidden_tools)
        )
        result = run_tier_b(
            load_scenarios(FIXTURES["dev"]), ForbiddenPolicy(), surface_builder=surface_builder
        )
        assert result["selection_precision"] == 0.0
        assert result["invalid_selection_rate"] == 1.0
        assert result["task_success_rate"] == 0.0
        # Still a scripted policy (live=False): gates stay None, never a
        # fabricated live verdict.
        assert result["meets_threshold"] is None
        assert result["pending_live_run"] is True
