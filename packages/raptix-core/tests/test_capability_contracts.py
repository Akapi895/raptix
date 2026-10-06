"""Capability contracts (Wave T2) — immutability + the invariants the
freeze review required before this contract shipped.

Pins:
  - every dataclass is frozen (immutable)
  - ImplementationSpec enforces its kind-specific required fields
  - CompletionSpec can never be unbounded (max_steps or a condition)
  - a WORKER implementation requires its manifest to carry a CompletionSpec
  - RequirementSpec carries no query field (core must not couple to AKG)
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError, fields

import pytest

from raptix_core.types.capability import (
    Artifact,
    CapabilityAvailability,
    CapabilityEligibility,
    CapabilityId,
    CapabilityManifest,
    CapabilityRequest,
    CapabilityResult,
    CapabilityStatus,
    CompletionSpec,
    ExecutionSpec,
    ExecutorKind,
    ImplementationKind,
    ImplementationSpec,
    Observation,
    RequirementKind,
    RequirementSpec,
    RiskClass,
    RoleId,
    SkillId,
)


def _adapter_impl(**overrides) -> ImplementationSpec:
    base = {
        "id": "nmap",
        "kind": ImplementationKind.ADAPTER,
        "adapter_id": "nmap",
        "executable": "nmap",
    }
    base.update(overrides)
    return ImplementationSpec(**base)


def _manifest(**overrides) -> CapabilityManifest:
    base = {
        "id": CapabilityId("network.scan"),
        "schema_version": 1,
        "description": "scan a network range",
        "implementations": (_adapter_impl(),),
    }
    base.update(overrides)
    return CapabilityManifest(**base)


# ── Immutability ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "instance",
    [
        RequirementSpec(
            id="credential.available", kind=RequirementKind.CREDENTIAL, description="x"
        ),
        _adapter_impl(),
        CompletionSpec(max_steps=10),
        _manifest(),
        CapabilityAvailability(capability_id=CapabilityId("x"), status=CapabilityStatus.AVAILABLE),
        CapabilityEligibility(capability_id=CapabilityId("x"), eligible=True),
        CapabilityRequest(capability_id=CapabilityId("x")),
        ExecutionSpec(executor_kind=ExecutorKind.COMMAND, executor_id="nmap"),
        Artifact(id="a1", artifact_ref="store://a1"),
        Observation(kind="open_port"),
    ],
)
def test_contracts_are_frozen(instance) -> None:
    first_field = fields(instance)[0].name
    with pytest.raises(FrozenInstanceError):
        setattr(instance, first_field, "mutated")


def test_capability_result_is_frozen() -> None:
    result = CapabilityResult(
        request=CapabilityRequest(capability_id=CapabilityId("x")), execution=None
    )
    with pytest.raises(FrozenInstanceError):
        result.success = True  # type: ignore[misc]


# ── RequirementSpec: no query field (core must not couple to AKG) ────────


def test_requirement_spec_has_no_query_field() -> None:
    names = {f.name for f in fields(RequirementSpec)}
    assert "query" not in names
    assert names == {"id", "kind", "description"}


def test_requirement_spec_rejects_empty_id_or_description() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        RequirementSpec(id="", kind=RequirementKind.SERVICE, description="x")
    with pytest.raises(ValueError, match="non-empty"):
        RequirementSpec(id="x", kind=RequirementKind.SERVICE, description="")


# ── ImplementationSpec: kind-specific required fields ────────────────────


def test_adapter_implementation_requires_adapter_id_and_executable() -> None:
    with pytest.raises(ValueError, match="ADAPTER"):
        ImplementationSpec(id="x", kind=ImplementationKind.ADAPTER)
    with pytest.raises(ValueError, match="ADAPTER"):
        ImplementationSpec(id="x", kind=ImplementationKind.ADAPTER, adapter_id="a")
    # OK once both are present.
    assert _adapter_impl().id == "nmap"


def test_worker_implementation_requires_worker_id() -> None:
    with pytest.raises(ValueError, match="WORKER"):
        ImplementationSpec(id="x", kind=ImplementationKind.WORKER)
    assert (
        ImplementationSpec(id="x", kind=ImplementationKind.WORKER, worker_id="w1").worker_id == "w1"
    )


def test_mcp_and_service_kinds_need_no_extra_field() -> None:
    assert (
        ImplementationSpec(id="ghidra-mcp", kind=ImplementationKind.MCP).kind
        is ImplementationKind.MCP
    )
    assert (
        ImplementationSpec(id="sliver", kind=ImplementationKind.SERVICE).kind
        is ImplementationKind.SERVICE
    )


# ── CompletionSpec: never unbounded ───────────────────────────────────────


def test_completion_spec_rejects_fully_unbounded() -> None:
    with pytest.raises(ValueError, match="max_steps or"):
        CompletionSpec()


def test_completion_spec_accepts_max_steps_alone() -> None:
    assert CompletionSpec(max_steps=5).max_steps == 5


def test_completion_spec_accepts_conditions_alone() -> None:
    spec = CompletionSpec(success_observations=("authentication.success",))
    assert spec.success_observations == ("authentication.success",)


def test_completion_spec_rejects_non_positive_max_steps() -> None:
    with pytest.raises(ValueError, match="positive"):
        CompletionSpec(max_steps=0)


# ── CapabilityManifest: WORKER implementation requires CompletionSpec ────


def test_manifest_with_worker_implementation_requires_completion() -> None:
    worker_impl = ImplementationSpec(
        id="exploit_worker", kind=ImplementationKind.WORKER, worker_id="w1"
    )
    with pytest.raises(ValueError, match="CompletionSpec"):
        _manifest(implementations=(worker_impl,), completion=None)
    # OK once a CompletionSpec is supplied.
    ok = _manifest(implementations=(worker_impl,), completion=CompletionSpec(max_steps=10))
    assert ok.completion is not None


def test_manifest_with_only_adapter_implementations_needs_no_completion() -> None:
    assert _manifest().completion is None  # must not raise


def test_manifest_rejects_empty_id_or_description() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        _manifest(id=CapabilityId(""))
    with pytest.raises(ValueError, match="non-empty"):
        _manifest(description="")


def test_manifest_rejects_schema_version_below_one() -> None:
    with pytest.raises(ValueError, match="schema_version"):
        _manifest(schema_version=0)


# ── Availability / Eligibility stay separate shapes ───────────────────────


def test_availability_has_no_missing_requirements_field() -> None:
    """Availability answers only 'can the system run this' — the unmet
    requirements list belongs exclusively to Eligibility."""
    names = {f.name for f in fields(CapabilityAvailability)}
    assert "unmet_requirements" not in names


def test_eligibility_has_no_executor_health_field() -> None:
    names = {f.name for f in fields(CapabilityEligibility)}
    assert "healthy_implementations" not in names


# ── Small value types ──────────────────────────────────────────────────


def test_id_types_are_str_subclasses() -> None:
    assert isinstance(CapabilityId("network.scan"), str)
    assert isinstance(SkillId("ad.credential_reuse.netexec"), str)
    assert isinstance(RoleId("recon"), str)


def test_observation_confidence_bounds() -> None:
    Observation(kind="open_port", confidence=0.0)
    Observation(kind="open_port", confidence=1.0)
    with pytest.raises(ValueError, match="confidence"):
        Observation(kind="open_port", confidence=1.5)
    with pytest.raises(ValueError, match="confidence"):
        Observation(kind="open_port", confidence=-0.1)


def test_execution_spec_rejects_empty_executor_id() -> None:
    with pytest.raises(ValueError, match="executor_id"):
        ExecutionSpec(executor_kind=ExecutorKind.COMMAND, executor_id="")


def test_artifact_rejects_empty_id_or_ref() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        Artifact(id="", artifact_ref="store://a1")
    with pytest.raises(ValueError, match="non-empty"):
        Artifact(id="a1", artifact_ref="")


def test_risk_class_values() -> None:
    assert {c.value for c in RiskClass} == {"low", "medium", "high", "critical"}
