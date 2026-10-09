"""Deterministic tests for the Wave T9 shadow-mode exposure module.

No LLM, no network, no live graph: capability manifests are injected via
fake carrier modules in ``sys.modules``, requirement answers come from
``GraphSnapshot`` mappings, and the only I/O asserted is the opt-in
shadow log record. The static-tool contract (``build_tools`` serves its
input unchanged whether or not shadow mode is on) is pinned the same way
the T0 telemetry test pins it.
"""

from __future__ import annotations

import json
import logging
import sys
import types
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest

from raptix.capabilities import AvailabilityEvaluator, CapabilityRegistry
from raptix.intelligence.tooling.exposure import (
    RECOVERY_TOOL_NAMES,
    ROLLOUT_ORDER,
    GraphSnapshot,
    active_exposure_tools,
    record_exposure_shadow,
    resolve_active_tools,
    resolve_exposure_mode,
    summarize_exposure_result,
)
from raptix_core.types.capability import (
    CapabilityId,
    CapabilityManifest,
    ImplementationKind,
    ImplementationSpec,
    RequirementKind,
    RequirementSpec,
    RoleId,
)


def _tool(name: str) -> SimpleNamespace:
    return SimpleNamespace(name=name, description="")


def _carrier_impl(impl_id: str, module_name: str, attr: str) -> ImplementationSpec:
    return ImplementationSpec(
        id=impl_id,
        kind=ImplementationKind.ADAPTER,
        adapter_id=f"test.{impl_id}",
        executable=f"{module_name}:{attr}",
    )


def _manifest(
    capability_id: str,
    *,
    impls: tuple[ImplementationSpec, ...],
    allowed_roles: tuple[str, ...] = (),
    allowed_phases: tuple[str, ...] | None = None,
    requirements: tuple[RequirementSpec, ...] = (),
    phase_affinity: tuple[str, ...] = (),
) -> CapabilityManifest:
    return CapabilityManifest(
        id=CapabilityId(capability_id),
        schema_version=1,
        description="test capability",
        phase_affinity=phase_affinity,
        allowed_phases=allowed_phases,
        allowed_roles=tuple(RoleId(role) for role in allowed_roles),
        requirements=requirements,
        implementations=impls,
        outputs=(),
    )


def _fake_tools_module(monkeypatch: pytest.MonkeyPatch, name: str, **attrs: object) -> str:
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    monkeypatch.setitem(sys.modules, name, module)
    return name


class _ExplodingTool:
    @property
    def name(self) -> str:
        raise RuntimeError("boom")


def test_tools_without_capability_mapping_always_proposed() -> None:
    tools = (_tool("bash"), _tool("generate_report"))
    result = resolve_active_tools(
        role="recon", current_tools=tools, registry=CapabilityRegistry(manifests=())
    )
    assert result.proposed_tools == tools
    assert result.current_tools == tools
    assert result.filtered_out == ()
    assert result.reason_map == {}


def test_recovery_surface_names_match_plan_and_runtime() -> None:
    assert RECOVERY_TOOL_NAMES == frozenset(
        {
            "inspect_context",
            "search_knowledge",
            "load_skill",
            "ask_user",
            "diagnose_execution",
            "ask_user_question",
        }
    )


def test_recovery_surface_never_filtered(monkeypatch: pytest.MonkeyPatch) -> None:
    def search_knowledge(query: str) -> str:
        return "kg"

    module_name = _fake_tools_module(
        monkeypatch, "_t9_recovery_tools", search_knowledge=search_knowledge
    )
    # Deliberately role-restricted so the capability is INELIGIBLE for
    # "recon" — the recovery guarantee must beat that verdict.
    manifest = _manifest(
        "recon.projection",
        impls=(_carrier_impl("m1", module_name, "search_knowledge"),),
        allowed_roles=("exploit",),
    )
    registry = CapabilityRegistry(manifests=(manifest,))
    result = resolve_active_tools(role="recon", current_tools=[search_knowledge], registry=registry)
    assert result.proposed_tools == (search_knowledge,)
    assert result.filtered_out == ()
    assert result.reason_map == {}


def test_role_restricted_capability_filtered_with_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scan = _tool("scan_target")
    module_name = _fake_tools_module(monkeypatch, "_t9_role_tools", scan_target=scan)
    manifest = _manifest(
        "recon.scan",
        impls=(_carrier_impl("i1", module_name, "scan_target"),),
        allowed_roles=("recon",),
    )
    registry = CapabilityRegistry(manifests=(manifest,))
    result = resolve_active_tools(role="exploit", current_tools=[scan], registry=registry)
    assert result.proposed_tools == ()
    assert result.filtered_out == (scan,)
    assert "recon.scan" in result.reason_map["scan_target"]
    assert "role" in result.reason_map["scan_target"]


def test_unmet_requirement_filters_and_reason_names_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cred_tool = _tool("use_credential")
    module_name = _fake_tools_module(monkeypatch, "_t9_req_tools", use_credential=cred_tool)
    requirement = RequirementSpec(
        id="credential.available",
        kind=RequirementKind.CREDENTIAL,
        description="a usable credential",
    )
    manifest = _manifest(
        "access.dump",
        impls=(_carrier_impl("i1", module_name, "use_credential"),),
        requirements=(requirement,),
    )
    registry = CapabilityRegistry(manifests=(manifest,))
    # No graph_state → the conservative T6 default: requirement unmet.
    unmet = resolve_active_tools(role="exploit", current_tools=[cred_tool], registry=registry)
    assert unmet.filtered_out == (cred_tool,)
    assert "credential.available" in unmet.reason_map["use_credential"]
    # Caller-supplied answers can satisfy the requirement.
    met = resolve_active_tools(
        role="exploit",
        graph_state=GraphSnapshot(requirement_results={"credential.available": True}),
        current_tools=[cred_tool],
        registry=registry,
    )
    assert met.proposed_tools == (cred_tool,)
    assert met.filtered_out == ()


def test_phase_affinity_ranks_but_never_excludes(monkeypatch: pytest.MonkeyPatch) -> None:
    early = _tool("early_scan")
    late = _tool("late_scan")
    module_name = _fake_tools_module(
        monkeypatch, "_t9_rank_tools", early_scan=early, late_scan=late
    )
    registry = CapabilityRegistry(
        manifests=(
            _manifest(
                "a.early",
                impls=(_carrier_impl("e1", module_name, "early_scan"),),
                phase_affinity=("initial_foothold",),
            ),
            _manifest("a.late", impls=(_carrier_impl("l1", module_name, "late_scan"),)),
        )
    )
    current = [late, early]
    # No phase: no bonus anywhere — original order preserved, both kept.
    neutral = resolve_active_tools(role="recon", current_tools=current, registry=registry)
    assert neutral.proposed_tools == (late, early)
    assert neutral.filtered_out == ()
    # Phase matching one affinity: re-ranked first, still both present —
    # ranking reorders, never excludes.
    ranked = resolve_active_tools(
        role="recon", phase="initial_foothold", current_tools=current, registry=registry
    )
    assert ranked.proposed_tools == (early, late)
    assert ranked.filtered_out == ()
    assert ranked.reason_map == {}


def test_allowed_phases_is_a_hard_constraint(monkeypatch: pytest.MonkeyPatch) -> None:
    tool = _tool("phase_tool")
    module_name = _fake_tools_module(monkeypatch, "_t9_phase_tools", phase_tool=tool)
    manifest = _manifest(
        "a.phased",
        impls=(_carrier_impl("i1", module_name, "phase_tool"),),
        allowed_phases=("initial_foothold",),
        phase_affinity=("initial_foothold",),
    )
    registry = CapabilityRegistry(manifests=(manifest,))
    outside = resolve_active_tools(
        role="recon", phase="network_propagation", current_tools=[tool], registry=registry
    )
    assert outside.filtered_out == (tool,)
    assert "phase" in outside.reason_map["phase_tool"]
    inside = resolve_active_tools(
        role="recon", phase="initial_foothold", current_tools=[tool], registry=registry
    )
    assert inside.proposed_tools == (tool,)


def test_unavailable_capability_is_filtered(monkeypatch: pytest.MonkeyPatch) -> None:
    tool = _tool("offline_tool")
    module_name = _fake_tools_module(monkeypatch, "_t9_avail_tools", offline_tool=tool)
    manifest = _manifest("a.offline", impls=(_carrier_impl("i1", module_name, "offline_tool"),))
    registry = CapabilityRegistry(manifests=(manifest,))
    availability = AvailabilityEvaluator(executable_probe=lambda _exe: False)
    result = resolve_active_tools(
        role="recon",
        current_tools=[tool],
        registry=registry,
        availability=availability,
    )
    assert result.filtered_out == (tool,)
    assert "unavailable" in result.reason_map["offline_tool"]


def test_available_executors_override_bare_name_probes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A binary-backed implementation under a tool-mapped capability is
    PARTIAL at worst (the carrier stays healthy) and the binary verdict
    comes from the supplied executor set, not PATH."""
    tool = _tool("dual_tool")
    module_name = _fake_tools_module(monkeypatch, "_t9_exec_tools", dual_tool=tool)
    manifest = _manifest(
        "a.dual",
        impls=(
            _carrier_impl("i1", module_name, "dual_tool"),
            ImplementationSpec(
                id="i2",
                kind=ImplementationKind.ADAPTER,
                adapter_id="test.i2",
                executable="missing-binary",
            ),
        ),
    )
    registry = CapabilityRegistry(manifests=(manifest,))
    with_binary = resolve_active_tools(
        role="recon",
        current_tools=[tool],
        registry=registry,
        available_executors={"missing-binary"},
    )
    assert with_binary.proposed_tools == (tool,)
    without_binary = resolve_active_tools(
        role="recon",
        current_tools=[tool],
        registry=registry,
        available_executors=frozenset(),
    )
    # The carrier keeps the capability PARTIAL — never excluded.
    assert without_binary.proposed_tools == (tool,)


def test_summarize_exposure_result_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    def search_knowledge(query: str) -> str:
        return "kg"

    scan = _tool("scan_target")
    module_name = _fake_tools_module(
        monkeypatch,
        "_t9_summary_tools",
        scan_target=scan,
        search_knowledge=search_knowledge,
    )
    manifest = _manifest(
        "recon.scan",
        impls=(_carrier_impl("i1", module_name, "scan_target"),),
        allowed_roles=("recon",),
    )
    registry = CapabilityRegistry(manifests=(manifest,))
    result = resolve_active_tools(
        role="exploit",
        current_tools=[scan, search_knowledge, _tool("bash")],
        registry=registry,
    )
    summary = summarize_exposure_result(result, role="exploit", phase=None)
    assert summary["role"] == "exploit"
    assert summary["phase"] is None
    assert summary["shadow"] is True
    assert summary["current_tool_count"] == 3
    assert summary["proposed_tool_count"] == 2
    assert summary["filtered_out_count"] == 1
    assert summary["filtered"] == [
        {"tool": "scan_target", "reason": result.reason_map["scan_target"]}
    ]
    assert summary["proposed_tool_names"] == ["search_knowledge", "bash"]
    assert "password" not in json.dumps(summary, default=str)


def test_record_exposure_shadow_noop_without_env(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.delenv("RAPTIX_EXPOSURE_SHADOW", raising=False)
    monkeypatch.setattr(logging.getLogger("raptix"), "propagate", True)
    with caplog.at_level(logging.INFO, logger="raptix.tools.exposure"):
        record_exposure_shadow("recon", [_tool("bash")])
    assert caplog.records == []


def test_record_exposure_shadow_logs_diff_when_enabled(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("RAPTIX_EXPOSURE_SHADOW", "1")
    monkeypatch.setattr(logging.getLogger("raptix"), "propagate", True)
    with caplog.at_level(logging.INFO, logger="raptix.tools.exposure"):
        record_exposure_shadow("recon", [_tool("bash")])
    records = [r for r in caplog.records if "exposure_shadow" in r.getMessage()]
    assert len(records) == 1
    payload = json.loads(records[0].getMessage().split(" ", 1)[1])
    assert payload["role"] == "recon"
    assert payload["proposed_tool_names"] == ["bash"]


def test_record_exposure_shadow_never_raises_on_malformed_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RAPTIX_EXPOSURE_SHADOW", "1")
    record_exposure_shadow("recon", [_ExplodingTool(), object()])


def test_resolve_active_tools_raises_loudly_outside_shadow_hook() -> None:
    with pytest.raises(RuntimeError, match="boom"):
        resolve_active_tools(
            role="recon",
            current_tools=[_ExplodingTool()],
            registry=CapabilityRegistry(manifests=()),
        )


def test_build_tools_serves_static_list_with_shadow_enabled(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Shadow mode never changes what build_tools serves — it only logs."""
    from raptix.intelligence.agents import build as build_module
    from raptix_core import plugin_loader

    baseline = {"a": _tool("a"), "b": _tool("b")}
    with patch.object(build_module, "entry_points", return_value=[]):
        with patch.object(plugin_loader, "entry_points", return_value=[]):
            monkeypatch.delenv("RAPTIX_EXPOSURE_SHADOW", raising=False)
            without = build_module.build_tools(role="soundwave", standard_tools=baseline)
            monkeypatch.setenv("RAPTIX_EXPOSURE_SHADOW", "1")
            monkeypatch.setattr(logging.getLogger("raptix"), "propagate", True)
            with caplog.at_level(logging.INFO, logger="raptix.tools.exposure"):
                with_shadow = build_module.build_tools(role="soundwave", standard_tools=baseline)
    assert with_shadow == without == [baseline["a"], baseline["b"]]
    assert any("exposure_shadow" in r.getMessage() for r in caplog.records)


# ───────────────────── Wave T12 — active mode ─────────────────────


class TestResolveExposureMode:
    def test_default_is_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", raising=False)
        monkeypatch.delenv("RAPTIX_EXPOSURE_SHADOW", raising=False)
        mode = resolve_exposure_mode("recon")
        assert mode.mode == "off"
        assert mode.role_active is False

    def test_unrecognized_value_fails_safe_to_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "enforce")
        assert resolve_exposure_mode("recon").mode == "off"

    def test_shadow_and_legacy_alias(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "shadow")
        assert resolve_exposure_mode("recon").mode == "shadow"
        monkeypatch.delenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE")
        monkeypatch.setenv("RAPTIX_EXPOSURE_SHADOW", "1")
        assert resolve_exposure_mode("recon").mode == "shadow"

    def test_active_requires_a_rollout_stage(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "active")
        monkeypatch.delenv("RAPTIX_EXPOSURE_ROLLOUT_STAGE", raising=False)
        stage_zero = resolve_exposure_mode("recon")
        assert stage_zero.mode == "active"
        assert stage_zero.role_active is False

    @pytest.mark.parametrize(
        ("stage", "role", "active"),
        [
            ("1", "recon", True),
            ("1", "exploit", False),
            ("2", "exploit", True),
            ("3", "postexploit", True),
            ("4", "ad_operator", True),
            ("5", "analyst", True),
            ("4", "analyst", False),
            ("99", "analyst", True),
            ("0", "recon", False),
            ("-1", "recon", False),
            ("not-a-number", "recon", False),
            ("", "recon", False),
        ],
    )
    def test_rollout_stage_gates_roles(
        self, monkeypatch: pytest.MonkeyPatch, stage: str, role: str, active: bool
    ) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "active")
        monkeypatch.setenv("RAPTIX_EXPOSURE_ROLLOUT_STAGE", stage)
        assert resolve_exposure_mode(role).role_active is active

    def test_rollout_order_matches_the_plan(self) -> None:
        assert ROLLOUT_ORDER == ("recon", "exploit", "postexploit", "ad_operator", "analyst")


class TestActiveExposureTools:
    def test_filters_ineligible_capability_tools(self, monkeypatch: pytest.MonkeyPatch) -> None:
        scan = _tool("scan_target")
        module_name = _fake_tools_module(monkeypatch, "_t12_active_tools", scan_target=scan)
        manifest = _manifest(
            "recon.scan",
            impls=(_carrier_impl("i1", module_name, "scan_target"),),
            allowed_roles=("recon",),
        )
        registry = CapabilityRegistry(manifests=(manifest,))
        with patch(
            "raptix.intelligence.tooling.exposure.CapabilityRegistry",
            return_value=registry,
        ):
            served = active_exposure_tools(
                "exploit", [scan, _tool("bash"), _tool("search_knowledge")]
            )
        names = [getattr(tool, "name", None) for tool in served]
        assert "scan_target" not in names
        assert {"bash", "search_knowledge"} <= set(names)

    def test_never_serves_an_empty_toolset(self, monkeypatch: pytest.MonkeyPatch) -> None:
        scan = _tool("scan_target")
        module_name = _fake_tools_module(monkeypatch, "_t12_empty_tools", scan_target=scan)
        manifest = _manifest(
            "recon.scan",
            impls=(_carrier_impl("i1", module_name, "scan_target"),),
            allowed_roles=("recon",),
        )
        registry = CapabilityRegistry(manifests=(manifest,))
        with patch(
            "raptix.intelligence.tooling.exposure.CapabilityRegistry",
            return_value=registry,
        ):
            served = active_exposure_tools("exploit", [scan])
        assert served == [scan]

    def test_resolution_failure_falls_back_to_static(self) -> None:
        served = active_exposure_tools("recon", [_ExplodingTool(), _tool("bash")])
        assert len(served) == 2
        assert served[1].name == "bash"


class TestBuildToolsActiveMode:
    """The T12 integration: build_tools serves the filtered set only for
    active-mode roles inside the rollout stage, using the REAL catalog."""

    @pytest.fixture()
    def baseline(self) -> dict[str, Any]:
        from raptix.execution.tools.defense.blue_cell import blue_cell_scan

        return {
            "blue_cell_scan": blue_cell_scan,
            "bash": _tool("bash"),
            "search_knowledge": _tool("search_knowledge"),
        }

    def _build(
        self,
        monkeypatch: pytest.MonkeyPatch,
        baseline: dict[str, Any],
        role: str,
    ) -> list[Any]:
        from raptix.intelligence.agents import build as build_module
        from raptix_core import plugin_loader

        with (
            patch.object(build_module, "entry_points", return_value=[]),
            patch.object(plugin_loader, "entry_points", return_value=[]),
        ):
            return build_module.build_tools(role=role, standard_tools=baseline)

    def test_off_by_default_serves_static(
        self, monkeypatch: pytest.MonkeyPatch, baseline: dict[str, Any]
    ) -> None:
        monkeypatch.delenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", raising=False)
        served = self._build(monkeypatch, baseline, "exploit")
        assert [getattr(tool, "name", None) for tool in served] == [
            "blue_cell_scan",
            "bash",
            "search_knowledge",
        ]

    def test_active_before_rollout_stage_serves_static(
        self, monkeypatch: pytest.MonkeyPatch, baseline: dict[str, Any]
    ) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "active")
        monkeypatch.setenv("RAPTIX_EXPOSURE_ROLLOUT_STAGE", "1")
        served = self._build(monkeypatch, baseline, "exploit")
        assert [getattr(tool, "name", None) for tool in served] == [
            "blue_cell_scan",
            "bash",
            "search_knowledge",
        ]

    def test_active_inside_rollout_stage_serves_filtered(
        self, monkeypatch: pytest.MonkeyPatch, baseline: dict[str, Any]
    ) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "active")
        monkeypatch.setenv("RAPTIX_EXPOSURE_ROLLOUT_STAGE", "2")
        served = self._build(monkeypatch, baseline, "exploit")
        names = [getattr(tool, "name", None) for tool in served]
        assert "blue_cell_scan" not in names
        assert {"bash", "search_knowledge"} <= set(names)

    def test_recovery_surface_survives_active_filtering(
        self, monkeypatch: pytest.MonkeyPatch, baseline: dict[str, Any]
    ) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "active")
        monkeypatch.setenv("RAPTIX_EXPOSURE_ROLLOUT_STAGE", "5")
        served = self._build(monkeypatch, baseline, "analyst")
        names = [getattr(tool, "name", None) for tool in served]
        assert "search_knowledge" in names

    def test_rollback_is_a_flag_flip_to_shadow(
        self, monkeypatch: pytest.MonkeyPatch, baseline: dict[str, Any]
    ) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "active")
        monkeypatch.setenv("RAPTIX_EXPOSURE_ROLLOUT_STAGE", "2")
        active = self._build(monkeypatch, baseline, "exploit")
        assert "blue_cell_scan" not in [getattr(tool, "name", None) for tool in active]
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "shadow")
        rolled_back = self._build(monkeypatch, baseline, "exploit")
        assert [getattr(tool, "name", None) for tool in rolled_back] == [
            "blue_cell_scan",
            "bash",
            "search_knowledge",
        ]

    def test_shadow_logging_stays_on_alongside_active(
        self,
        monkeypatch: pytest.MonkeyPatch,
        baseline: dict[str, Any],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "active")
        monkeypatch.setenv("RAPTIX_EXPOSURE_ROLLOUT_STAGE", "2")
        monkeypatch.setattr(logging.getLogger("raptix"), "propagate", True)
        with caplog.at_level(logging.INFO, logger="raptix.tools.exposure"):
            self._build(monkeypatch, baseline, "exploit")
        records = [r for r in caplog.records if "exposure_shadow" in r.getMessage()]
        assert len(records) == 1
        payload = json.loads(records[0].getMessage().split(" ", 1)[1])
        assert "blue_cell_scan" in payload["current_tool_names"]
        assert "blue_cell_scan" not in payload["proposed_tool_names"]

    def test_shadow_mode_alone_enables_logging(
        self,
        monkeypatch: pytest.MonkeyPatch,
        baseline: dict[str, Any],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """The T9 legacy env var is no longer the only logging switch:
        the new mode var enables the monitoring record by itself."""
        monkeypatch.setenv("RAPTIX_DYNAMIC_TOOL_EXPOSURE", "shadow")
        monkeypatch.delenv("RAPTIX_EXPOSURE_SHADOW", raising=False)
        monkeypatch.setattr(logging.getLogger("raptix"), "propagate", True)
        with caplog.at_level(logging.INFO, logger="raptix.tools.exposure"):
            self._build(monkeypatch, baseline, "soundwave")
        assert any("exposure_shadow" in r.getMessage() for r in caplog.records)
