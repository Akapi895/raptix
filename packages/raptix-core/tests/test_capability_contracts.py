"""Capability contracts (Wave T2) — immutability + the invariants two
rounds of external review required before this contract shipped.

Pins:
  - every dataclass is frozen (immutable)
  - ImplementationSpec enforces its kind-specific required fields
  - CompletionSpec.max_steps is a REQUIRED hard bound (round 2: a success/
    failure condition alone is not a bound — it may never fire)
  - a WORKER implementation requires its manifest to carry a CompletionSpec
  - RequirementSpec carries no query field (core must not couple to AKG)
  - ExecutionSpec carries implementation_id (round 2: provenance was
    otherwise lost between an implementation and its execution)
  - CapabilityResult.executions is a tuple, not a single execution (round
    2: a bounded worker can run several executions per request)
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
    ExecutionRecord,
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


def _execution_spec(**overrides) -> ExecutionSpec:
    base = {
        "implementation_id": "nmap",
        "executor_kind": ExecutorKind.COMMAND,
        "executor_id": "nmap",
    }
    base.update(overrides)
    return ExecutionSpec(**base)


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
        _execution_spec(),
        ExecutionRecord(spec=_execution_spec()),
        Artifact(id="a1", artifact_ref="store://a1"),
        Observation(kind="open_port"),
    ],
)
def test_contracts_are_frozen(instance) -> None:
    first_field = fields(instance)[0].name
    with pytest.raises(FrozenInstanceError):
        setattr(instance, first_field, "mutated")


def test_capability_result_is_frozen() -> None:
    result = CapabilityResult(request=CapabilityRequest(capability_id=CapabilityId("x")))
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


# ── CompletionSpec: max_steps is a required hard bound ────────────────────


def test_completion_spec_requires_max_steps() -> None:
    """A success/failure condition alone is not a bound — it may never
    fire. Round-2 review: this used to be accepted and let a worker run
    forever when its success_observations condition never matched."""
    with pytest.raises(TypeError):
        CompletionSpec()  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        CompletionSpec(success_observations=("authentication.success",))  # type: ignore[call-arg]


def test_completion_spec_accepts_max_steps_alone() -> None:
    assert CompletionSpec(max_steps=5).max_steps == 5


def test_completion_spec_accepts_max_steps_with_conditions() -> None:
    spec = CompletionSpec(max_steps=10, success_observations=("authentication.success",))
    assert spec.max_steps == 10
    assert spec.success_observations == ("authentication.success",)


def test_completion_spec_rejects_non_positive_max_steps() -> None:
    with pytest.raises(ValueError, match="positive"):
        CompletionSpec(max_steps=0)
    with pytest.raises(ValueError, match="positive"):
        CompletionSpec(max_steps=-1)


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


def test_manifest_allowed_roles_defaults_to_unrestricted_tuple() -> None:
    """Documented (not code-enforced) semantics: () means every role,
    matching PluginBundle.roles's "empty tuple = unrestricted" convention
    — not "no roles allowed". This test pins the default value only; the
    "unrestricted" interpretation lives in the module docstring and is a
    contract for whatever runtime eligibility evaluator reads this field."""
    assert _manifest().allowed_roles == ()


# ── Availability / Eligibility stay separate shapes ───────────────────────


def test_availability_has_no_missing_requirements_field() -> None:
    """Availability answers only 'can the system run this' — the unmet
    requirements list belongs exclusively to Eligibility."""
    names = {f.name for f in fields(CapabilityAvailability)}
    assert "unmet_requirements" not in names


def test_eligibility_has_no_executor_health_field() -> None:
    names = {f.name for f in fields(CapabilityEligibility)}
    assert "healthy_implementations" not in names


# ── ExecutionSpec: implementation_id provenance ───────────────────────────


def test_execution_spec_requires_implementation_id() -> None:
    with pytest.raises(ValueError, match="implementation_id"):
        ExecutionSpec(implementation_id="", executor_kind=ExecutorKind.COMMAND, executor_id="nmap")


def test_execution_spec_rejects_empty_executor_id() -> None:
    with pytest.raises(ValueError, match="executor_id"):
        _execution_spec(executor_id="")


def test_two_implementations_of_one_capability_stay_distinguishable() -> None:
    """The scenario the round-2 review named: ad.netexec.smb vs
    ad.impacket.psexec both resolve through ExecutorKind.COMMAND — only
    implementation_id tells them apart once execution starts."""
    via_netexec = _execution_spec(implementation_id="ad.netexec.smb", executor_id="netexec")
    via_impacket = _execution_spec(
        implementation_id="ad.impacket.psexec", executor_id="impacket-psexec"
    )
    assert via_netexec.executor_kind is via_impacket.executor_kind is ExecutorKind.COMMAND
    assert via_netexec.implementation_id != via_impacket.implementation_id


# ── ExecutionRecord / CapabilityResult: multiple executions per request ──


def test_capability_result_holds_multiple_execution_records() -> None:
    """A bounded worker can run several executions per request (e.g.
    curl -> research -> PoC -> bash) — the round-2 fix from a single
    ``execution: ExecutionSpec | None`` field."""
    curl = ExecutionRecord(
        spec=_execution_spec(implementation_id="curl", executor_id="curl"), success=True
    )
    bash = ExecutionRecord(
        spec=_execution_spec(implementation_id="bash", executor_id="bash"), success=True
    )
    result = CapabilityResult(
        request=CapabilityRequest(capability_id=CapabilityId("exploit_unknown_service")),
        executions=(curl, bash),
        success=True,
    )
    assert len(result.executions) == 2
    assert result.executions[0].spec.implementation_id == "curl"
    assert result.executions[1].spec.implementation_id == "bash"


def test_execution_record_artifacts_stay_attributed_to_their_execution() -> None:
    a1 = Artifact(id="a1", artifact_ref="store://a1")
    a2 = Artifact(id="a2", artifact_ref="store://a2")
    rec1 = ExecutionRecord(spec=_execution_spec(implementation_id="curl"), artifacts=(a1,))
    rec2 = ExecutionRecord(spec=_execution_spec(implementation_id="bash"), artifacts=(a2,))
    result = CapabilityResult(
        request=CapabilityRequest(capability_id=CapabilityId("x")), executions=(rec1, rec2)
    )
    assert result.executions[0].artifacts == (a1,)
    assert result.executions[1].artifacts == (a2,)


def test_capability_result_defaults_to_no_executions() -> None:
    """A pure-read capability that never ran an executor."""
    result = CapabilityResult(request=CapabilityRequest(capability_id=CapabilityId("x")))
    assert result.executions == ()


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


def test_artifact_rejects_empty_id_or_ref() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        Artifact(id="", artifact_ref="store://a1")
    with pytest.raises(ValueError, match="non-empty"):
        Artifact(id="a1", artifact_ref="")


def test_risk_class_values() -> None:
    assert {c.value for c in RiskClass} == {"low", "medium", "high", "critical"}
