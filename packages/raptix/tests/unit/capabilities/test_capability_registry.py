"""Deterministic tests for the Wave T6 capability catalog + evaluators.

No LLM, no network: availability uses injected probes; the real
in-process carriers are exercised through the import probe exactly as
the startup health check would.
"""

from __future__ import annotations

from typing import Any

import pytest

from raptix.capabilities import (
    AvailabilityEvaluator,
    CapabilityRegistry,
    EligibilityEvaluator,
    UnknownCapabilityError,
    build_catalog,
    build_execution_provenance,
    health_check,
)
from raptix_core.types.capability import (
    CapabilityId,
    CapabilityStatus,
    CompletionSpec,
    ImplementationKind,
    ImplementationSpec,
    RequirementKind,
    RequirementSpec,
    RiskClass,
    RoleId,
)


class TestCatalog:
    T1_CAPABILITIES = {
        "defense.scan_coverage",
        "defense.generate_brief",
        "defense.export_navigator",
        "osint.enrich_domain",
        "analyst.propose_patch",
        "analyst.verify_patch",
        "analyst.run_scan_shard",
        "web.scan_secrets",
        "recon.detect_tech_stack",
        "analyst.fuzz_target",
        "research.web_fetch",
        "research.web_search",
    }

    T7_CAPABILITIES = {
        "network.scan",
        "network.discover_subdomains",
        "web.test_injection",
        "web.fuzz_paths",
        "web.scan_web",
        "access.move_laterally",
        "access.credential_dump",
        "network.capture_ntlm",
    }

    # TC-2/5/7/8 added profile-backed implementations and capabilities.
    TC237_CAPABILITIES = {
        "web.scan_templates",
        "access.crack_hash",
        "network.snmp_enumerate",
        "contracts.audit_static",
        "ad.collect_bloodhound",
    }

    T10_CAPABILITIES = {
        "exploit.unknown_service",
    }

    def test_covers_every_t1_semantic_capability_plus_t7_binaries(self) -> None:
        ids = {str(m.id) for m in build_catalog()}
        assert (
            ids
            == self.T1_CAPABILITIES
            | self.T7_CAPABILITIES
            | self.TC237_CAPABILITIES
            | self.T10_CAPABILITIES
        )

    def test_ids_are_unique_and_schema_versioned(self) -> None:
        manifests = build_catalog()
        ids = [str(m.id) for m in manifests]
        assert len(ids) == len(set(ids))
        assert all(m.schema_version == 1 for m in manifests)

    def test_worker_implementation_pins_a_bounded_completion(self) -> None:
        """The catalog's one WORKER-kind capability (T10's plan example)
        declares its bounded termination; everything else stays
        ADAPTER-carried. A WORKER impl without a CompletionSpec raises
        in the frozen T2 contract, so only the shape needs pinning."""
        for manifest in build_catalog():
            worker_impls = [
                impl for impl in manifest.implementations if impl.kind is ImplementationKind.WORKER
            ]
            if str(manifest.id) in self.T10_CAPABILITIES:
                assert worker_impls, manifest.id
                assert manifest.completion is not None, manifest.id
                assert manifest.completion.max_steps >= 1, manifest.id
            else:
                assert not worker_impls, manifest.id

    def test_phase_affinity_is_soft_and_allowed_phases_unused(self) -> None:
        # allowed_phases (hard) is used sparingly â€” the initial catalog
        # leaves it None everywhere; phase_affinity is ranking only.
        for manifest in build_catalog():
            assert manifest.allowed_phases is None

    def test_in_process_carriers_import_cleanly(self) -> None:
        evaluator = AvailabilityEvaluator()
        for manifest in build_catalog():
            if not all(":" in (impl.executable or "") for impl in manifest.implementations):
                continue  # T7 binary-backed impls probe PATH, not imports
            availability = evaluator.evaluate(manifest)
            assert availability.status is CapabilityStatus.AVAILABLE, (
                f"{manifest.id}: {availability.healthy_implementations}"
            )

    def test_t7_implementations_declare_base_profile(self) -> None:
        for manifest in build_catalog():
            if str(manifest.id) not in self.T7_CAPABILITIES:
                continue
            for impl in manifest.implementations:
                # TC-2's netexec second implementation is the deliberate
                # profile-backed exception.
                if impl.id == "access.move_laterally.netexec":
                    assert impl.profile == "sandbox-ad", manifest.id
                    continue
                assert impl.profile == "base", manifest.id
                assert impl.adapter_id, manifest.id
                assert ":" not in (impl.executable or ""), manifest.id

    def test_fuzz_target_declares_two_implementations(self) -> None:
        manifest = next(m for m in build_catalog() if str(m.id) == "analyst.fuzz_target")
        assert [impl.id for impl in manifest.implementations] == [
            "fuzz_classify",
            "fuzz_harness",
        ]
        assert manifest.risk_class is RiskClass.HIGH


class TestRegistry:
    def test_get_known_and_unknown(self) -> None:
        registry = CapabilityRegistry()
        manifest = registry.get("research.web_search")
        assert str(manifest.id) == "research.web_search"
        manifest = registry.get("network.scan")  # T7 binary-backed capability
        assert str(manifest.id) == "network.scan"
        with pytest.raises(UnknownCapabilityError):
            registry.get("network.nonexistent")

    def test_contains_and_len(self) -> None:
        registry = CapabilityRegistry()
        assert "research.web_search" in registry
        assert "network.scan" in registry
        assert "exploit.unknown_service" in registry
        # TC-2/5/7/8 added web.scan_templates, access.crack_hash,
        # network.snmp_enumerate and contracts.audit_static to the 21
        # T7-era manifests.
        assert len(registry) == 26

    def test_for_role_unrestricted_means_every_role(self) -> None:
        registry = CapabilityRegistry()
        roles = {str(m.id) for m in registry.for_role("recon")}
        # web_search/web_fetch declare allowed_roles=() â†’ unrestricted.
        assert "research.web_search" in roles
        assert "research.web_fetch" in roles

    def test_for_role_respects_restriction(self) -> None:
        registry = CapabilityRegistry()
        blue_cell = {str(m.id) for m in registry.for_role("blue_cell")}
        assert "defense.scan_coverage" in blue_cell
        assert "osint.enrich_domain" not in blue_cell

    def test_duplicate_capability_id_rejected(self) -> None:
        manifests = build_catalog()
        with pytest.raises(ValueError, match="duplicate capability id"):
            CapabilityRegistry(manifests + (manifests[0],))

    def test_health_snapshot_is_queryable(self) -> None:
        registry = CapabilityRegistry()
        snapshot = registry.health_snapshot()
        assert set(snapshot) == {str(m.id) for m in registry}
        for entry in snapshot.values():
            assert entry["status"] in {"available", "partial", "unavailable"}
            assert isinstance(entry["healthy_implementations"], list)

    def test_startup_health_check_with_probes_injected(self) -> None:
        # The real catalog probes PATH (sandbox binaries may legitimately
        # be absent on a dev host â€” PARTIAL passes, UNAVAILABLE fails)
        # and resolves worker ids through T10's WorkerRegistry â€” without
        # one, the catalog's WORKER capability is honestly UNAVAILABLE.
        from raptix.execution.workers import WorkerRegistry, WorkerSpec

        evaluator = AvailabilityEvaluator(
            executable_probe=lambda _exe: True,
            worker_registry=WorkerRegistry(
                [WorkerSpec(worker_id="exploit_worker", allowed_primitives=("bash",))]
            ).resolves,
        )
        assert health_check(CapabilityRegistry(availability=evaluator)) is True

    def test_startup_health_check_fails_when_probe_finds_nothing(self) -> None:
        evaluator = AvailabilityEvaluator(executable_probe=lambda _exe: False)
        assert health_check(CapabilityRegistry(availability=evaluator)) is False

    def test_startup_gate_requires_a_worker_registry_for_worker_health(self) -> None:
        # The frozen T2/T6 invariant: with no worker registry wired, the
        # catalog's WORKER capability is honestly UNAVAILABLE and the
        # default startup gate rejects.
        registry = CapabilityRegistry(
            availability=AvailabilityEvaluator(executable_probe=lambda _exe: True)
        )
        assert registry.health_snapshot()["exploit.unknown_service"]["status"] == "unavailable"
        assert health_check(registry) is False


class TestAvailabilityEvaluator:
    def _manifest(self, implementations: tuple, **kwargs: Any):
        from raptix_core.types.capability import CapabilityManifest

        return CapabilityManifest(
            id=CapabilityId("test.cap"),
            schema_version=1,
            description="test",
            implementations=implementations,
            **kwargs,
        )

    def test_no_implementations_is_unavailable(self) -> None:
        evaluator = AvailabilityEvaluator(executable_probe=lambda _exe: True)
        availability = evaluator.evaluate(self._manifest(()))
        assert availability.status is CapabilityStatus.UNAVAILABLE
        assert availability.healthy_implementations == ()

    def test_partial_when_some_implementations_healthy(self) -> None:
        impls = (
            ImplementationSpec(
                id="a",
                kind=ImplementationKind.ADAPTER,
                adapter_id="ad.a",
                executable="module_a:attr",
            ),
            ImplementationSpec(
                id="b",
                kind=ImplementationKind.ADAPTER,
                adapter_id="ad.b",
                executable="module_b:attr",
            ),
        )
        evaluator = AvailabilityEvaluator(executable_probe=lambda exe: exe == "module_a:attr")
        availability = evaluator.evaluate(self._manifest(impls))
        assert availability.status is CapabilityStatus.PARTIAL
        assert availability.healthy_implementations == ("a",)

    def test_worker_without_registry_is_unavailable(self) -> None:
        impls = (ImplementationSpec(id="w", kind=ImplementationKind.WORKER, worker_id="wf"),)
        evaluator = AvailabilityEvaluator()
        availability = evaluator.evaluate(
            self._manifest(impls, completion=CompletionSpec(max_steps=5))
        )
        assert availability.status is CapabilityStatus.UNAVAILABLE

    def test_worker_with_resolving_registry_is_available(self) -> None:
        impls = (ImplementationSpec(id="w", kind=ImplementationKind.WORKER, worker_id="wf"),)
        evaluator = AvailabilityEvaluator(worker_registry=lambda worker_id: worker_id == "wf")
        availability = evaluator.evaluate(
            self._manifest(impls, completion=CompletionSpec(max_steps=5))
        )
        assert availability.status is CapabilityStatus.AVAILABLE

    def test_worker_with_unresolving_registry_is_unavailable(self) -> None:
        impls = (ImplementationSpec(id="w", kind=ImplementationKind.WORKER, worker_id="wf"),)

        def _never_resolves(worker_id: str) -> bool:
            return bool(worker_id) and False

        evaluator = AvailabilityEvaluator(worker_registry=_never_resolves)
        availability = evaluator.evaluate(
            self._manifest(impls, completion=CompletionSpec(max_steps=5))
        )
        assert availability.status is CapabilityStatus.UNAVAILABLE

    def test_mcp_unavailable_without_executor_probe(self) -> None:
        impls = (ImplementationSpec(id="mcp", kind=ImplementationKind.MCP),)
        evaluator = AvailabilityEvaluator()
        assert evaluator.evaluate(self._manifest(impls)).status is CapabilityStatus.UNAVAILABLE

    def test_mcp_available_when_executor_probe_reports_healthy(self) -> None:
        impls = (ImplementationSpec(id="mcp", kind=ImplementationKind.MCP),)

        def _always_healthy(implementation: ImplementationSpec) -> bool:
            return implementation.id == "mcp"

        evaluator = AvailabilityEvaluator(executor_probe=_always_healthy)
        assert evaluator.evaluate(self._manifest(impls)).status is CapabilityStatus.AVAILABLE


class TestEligibilityEvaluator:
    def _manifest(self, **kwargs: Any):
        from raptix_core.types.capability import CapabilityManifest

        defaults: dict[str, Any] = {
            "id": CapabilityId("test.cap"),
            "schema_version": 1,
            "description": "test",
        }
        defaults.update(kwargs)
        return CapabilityManifest(**defaults)

    def test_role_denied(self) -> None:
        manifest = self._manifest(allowed_roles=(RoleId("blue_cell"),))
        result = EligibilityEvaluator().evaluate(manifest, role="recon")
        assert result.eligible is False
        assert result.reason is not None and "not allowed" in result.reason

    def test_role_allowed(self) -> None:
        manifest = self._manifest(allowed_roles=(RoleId("blue_cell"),))
        assert EligibilityEvaluator().evaluate(manifest, role="blue_cell").eligible is True

    def test_unrestricted_roles_admit_any_role(self) -> None:
        manifest = self._manifest()
        assert EligibilityEvaluator().evaluate(manifest, role="analyst").eligible is True

    def test_allowed_phases_is_hard_constraint(self) -> None:
        manifest = self._manifest(allowed_phases=("initial_foothold",))
        assert (
            EligibilityEvaluator()
            .evaluate(manifest, role="recon", phase="initial_foothold")
            .eligible
            is True
        )
        denied = EligibilityEvaluator().evaluate(
            manifest, role="recon", phase="network_propagation"
        )
        assert denied.eligible is False
        assert denied.unmet_requirements == ()

    def test_phase_restricted_requires_a_phase(self) -> None:
        manifest = self._manifest(allowed_phases=("initial_foothold",))
        result = EligibilityEvaluator().evaluate(manifest, role="recon")
        assert result.eligible is False
        assert result.reason is not None and "no phase" in result.reason

    def test_requirements_unmet_without_evaluator(self) -> None:
        manifest = self._manifest(
            requirements=(
                RequirementSpec(
                    id="credential.available",
                    kind=RequirementKind.CREDENTIAL,
                    description="a usable credential exists",
                ),
            )
        )
        result = EligibilityEvaluator().evaluate(manifest, role="exploit")
        assert result.eligible is False
        assert result.unmet_requirements == ("credential.available",)

    def test_requirements_evaluated_by_runtime_evaluator(self) -> None:
        manifest = self._manifest(
            requirements=(
                RequirementSpec(
                    id="credential.available",
                    kind=RequirementKind.CREDENTIAL,
                    description="a usable credential exists",
                ),
            )
        )

        class _AlwaysYes:
            def check(self, requirement: RequirementSpec) -> bool:
                return requirement.id == "credential.available"

        result = EligibilityEvaluator(_AlwaysYes()).evaluate(manifest, role="exploit")
        assert result.eligible is True
        assert result.unmet_requirements == ()


class TestExecutionProvenance:
    def test_full_version_chain(self) -> None:
        provenance = build_execution_provenance(
            tool_name="nmap",
            tool_version="7.94",
            adapter_version="1.0.0",
            parser_version="nmap_xml@1",
            tool_data_version="nuclei-templates@9.8.2",
        )
        assert provenance == {
            "tool_name": "nmap",
            "tool_version": "7.94",
            "adapter_version": "1.0.0",
            "parser_version": "nmap_xml@1",
            "tool_data_version": "nuclei-templates@9.8.2",
        }

    def test_optional_versions_omitted_when_unknown(self) -> None:
        provenance = build_execution_provenance(tool_name="web_fetch")
        assert provenance == {"tool_name": "web_fetch"}

    def test_tool_name_required(self) -> None:
        with pytest.raises(ValueError, match="tool_name"):
            build_execution_provenance(tool_name="")

    def test_carries_only_version_strings_never_parameter_values(self) -> None:
        # Guardrail: telemetry/provenance never records raw parameter
        # values (credentials, hashes, tokens, keys).
        provenance = build_execution_provenance(
            tool_name="netexec",
            tool_version="1.3.0",
        )
        assert all(isinstance(v, str) for v in provenance.values())
