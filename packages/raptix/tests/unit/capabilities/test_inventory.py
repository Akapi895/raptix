"""TC-0 coverage-inventory tests.

Deterministic: registries are injected (no PATH/import probing), so the
report content is stable regardless of the host running the tests.
"""

from __future__ import annotations

import json

import pytest

from raptix.capabilities import (
    build_catalog,
    build_coverage_inventory,
    collect_provenance,
    undeclared_claims,
    write_coverage_report,
)
from raptix_core.types.capability import (
    CapabilityId,
    CapabilityManifest,
    CapabilityStatus,
    ImplementationKind,
    ImplementationSpec,
)

_ADAPTIVE = (
    "nmap_xml",
    "subfinder",
    "sqlmap_log",
    "gobuster",
    "nikto_txt",
    "impacket_txt",
    "responder_log",
)


class _HealthyEvaluator:
    """Availability stub: everything AVAILABLE except worker-only caps."""

    def evaluate(self, manifest: CapabilityManifest):
        from raptix_core.types.capability import CapabilityAvailability

        has_worker = any(
            impl.kind is ImplementationKind.WORKER for impl in manifest.implementations
        )
        has_adapter = any(
            impl.kind is ImplementationKind.ADAPTER for impl in manifest.implementations
        )
        if has_worker and not has_adapter:
            status = CapabilityStatus.UNAVAILABLE
            healthy: tuple[str, ...] = ()
        else:
            status = CapabilityStatus.AVAILABLE
            healthy = tuple(impl.id for impl in manifest.implementations)
        return CapabilityAvailability(
            capability_id=manifest.id, status=status, healthy_implementations=healthy
        )


def _inventory(**kwargs: object) -> dict:
    defaults: dict = {
        "availability": _HealthyEvaluator(),
        "adapter_ids": {"network.nmap", "web.sqlmap"},
        "parser_format_ids": set(_ADAPTER_FORMATS),
    }
    defaults.update(kwargs)  # type: ignore[arg-type]
    return build_coverage_inventory(**defaults)  # type: ignore[arg-type]


_ADAPTER_FORMATS = (
    "nmap_xml",
    "subfinder",
    "sqlmap_log",
    "gobuster",
    "nikto_txt",
    "impacket_txt",
    "responder_log",
    "nuclei_jsonl",
    "john_pot",
    "snmpwalk_txt",
    "slither_json",
    "peas_txt",
    "pspy_log",
    "crackmapexec",
)


class TestCoverageInventory:
    def test_all_baseline_manifests_accounted(self) -> None:
        inventory = _inventory(
            manifests=build_catalog(),
            adapter_ids={
                "network.nmap",
                "network.subfinder",
                "web.sqlmap",
                "web.gobuster",
                "web.nikto",
                "ad.impacket.lateral",
                "ad.impacket.cred_dump",
                "ad.responder",
                "web.nuclei",
                "ad.netexec",
                "credentials.john",
                "network.snmpwalk",
                "contracts.slither",
                "ad.netexec.bloodhound",
            },
        )
        assert inventory["schema"] == "raptix.coverage-inventory/1"
        capability_ids = [row["capability_id"] for row in inventory["capabilities"]]
        # TC-2/5/7 added web.scan_templates, access.crack_hash and
        # network.snmp_enumerate to the 21 T7-era manifests.
        assert len(capability_ids) == len(set(capability_ids)) == 26
        baseline_ids = {
            "network.scan",
            "network.discover_subdomains",
            "web.test_injection",
            "web.fuzz_paths",
            "web.scan_web",
            "access.move_laterally",
            "access.credential_dump",
            "network.capture_ntlm",
            "exploit.unknown_service",
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
        assert baseline_ids <= set(capability_ids)

    def test_adapter_rows_report_registration_and_route(self) -> None:
        inventory = _inventory(manifests=build_catalog())
        rows = {row["capability_id"]: row for row in inventory["capabilities"]}
        nmap = rows["network.scan"]
        impl = nmap["implementations"][0]
        assert impl["adapter_registered"] is True
        assert impl["route"] == "adapter:network.nmap"
        sqlmap = rows["web.test_injection"]["implementations"][0]
        assert sqlmap["adapter_registered"] is True

    def test_artifact_outputs_vs_semantic_outputs(self) -> None:
        inventory = _inventory(manifests=build_catalog())
        rows = {row["capability_id"]: row for row in inventory["capabilities"]}
        assert rows["network.scan"]["output_formats"] == ("nmap_xml",)
        assert rows["network.scan"]["semantic_outputs"] == ()
        assert rows["defense.scan_coverage"]["output_formats"] == ()
        assert rows["defense.scan_coverage"]["semantic_outputs"] == ("defense.detection_hit",)

    def test_worker_capability_is_unavailable_without_registry(self) -> None:
        inventory = _inventory(manifests=build_catalog())
        rows = {row["capability_id"]: row for row in inventory["capabilities"]}
        worker_cap = rows["exploit.unknown_service"]
        assert worker_cap["implementations"][0]["route"] == "worker:exploit_worker"
        assert worker_cap["availability_status"] == "unavailable"

    def test_missing_parser_format_is_visible_not_guessed(self) -> None:
        from raptix_core.types.capability import (
            CapabilityManifest,
        )

        manifests = (
            CapabilityManifest(
                id=CapabilityId("test.with_sarif"),
                schema_version=1,
                description="cap declaring an unregistered artifact format",
                implementations=(
                    ImplementationSpec(
                        id="x",
                        kind=ImplementationKind.ADAPTER,
                        adapter_id="network.nmap",
                        executable="nmap",
                    ),
                ),
                outputs=("sarif", "defense.semantic"),
            ),
        )
        inventory = _inventory(manifests=manifests)
        row = inventory["capabilities"][0]
        assert row["missing_parsers"] == ("sarif",)
        assert ("sarif", False) in row["parser_registered"]
        assert inventory["summary"]["missing_parser_formats"] == ["sarif"]

    def test_default_inventory_reports_no_missing_parsers_after_tc1(self) -> None:
        # TC-1 acceptance: every base-profile adapter output format has a
        # registered parser, so the live catalog has no missing formats.
        inventory = _inventory(
            manifests=build_catalog(),
            adapter_ids={
                "network.nmap",
                "network.subfinder",
                "web.sqlmap",
                "web.gobuster",
                "web.nikto",
                "ad.impacket.lateral",
                "ad.impacket.cred_dump",
                "ad.responder",
                "web.nuclei",
                "ad.netexec",
                "credentials.john",
                "network.snmpwalk",
                "contracts.slither",
                "ad.netexec.bloodhound",
            },
        )
        assert inventory["summary"]["missing_parser_formats"] == []
        assert inventory["summary"]["unregistered_adapters"] == []


class TestUndeclaredClaims:
    def test_claims_are_listed_with_valid_kinds_and_sources(self) -> None:
        claims = undeclared_claims()
        assert len(claims) >= 6
        allowed = {
            "offline_analysis",
            "source_generation",
            "execution_unprovisioned",
            "wording_gap",
            "reproducibility_gap",
        }
        for claim in claims:
            assert claim.kind in allowed
            assert claim.claim and claim.source and claim.note

    def test_inventory_carries_the_claims(self) -> None:
        inventory = _inventory(manifests=build_catalog())
        assert inventory["summary"]["undeclared_claims_count"] == len(undeclared_claims())
        claims = {entry["claim"] for entry in inventory["undeclared_claims"]}
        assert any("fuzz" in claim for claim in claims)
        assert any("Nuclei templates" in claim for claim in claims)


class TestReportWriting:
    def test_report_refuses_frozen_t0_baseline_paths(self, tmp_path: object) -> None:
        baseline_dir = tmp_path / "benchmarks" / "tool_eval" / "baseline"  # type: ignore[union-attr]
        baseline_dir.mkdir(parents=True)
        inventory = _inventory(manifests=build_catalog())
        for name in ("baseline.jsonl", "assembled_baseline.jsonl"):
            frozen = baseline_dir / name
            with pytest.raises(ValueError, match="frozen T0 baseline"):
                write_coverage_report(frozen, inventory)

    def test_report_writes_json_with_provenance(self, tmp_path: object) -> None:
        target = tmp_path / "run" / "coverage.json"  # type: ignore[union-attr]
        inventory = _inventory(manifests=build_catalog(), provenance={"checkout": "abc"})
        written = write_coverage_report(target, inventory)
        assert written.exists()
        data = json.loads(written.read_text(encoding="utf-8"))
        assert data["provenance"] == {"checkout": "abc"}
        assert data["summary"]["manifest_count"] == 26
        assert len(data["capabilities"]) == 26


class TestProvenance:
    def test_collect_provenance_records_unset_sources(self) -> None:
        provenance = collect_provenance()
        assert provenance["image_ref"] == "unknown"
        assert provenance["image_ref_source"] == "unset"
        assert provenance["profile_source"] == "unset"
        assert "checkout" in provenance

    def test_collect_provenance_reads_operator_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RAPTIX_COVERAGE_IMAGE_REF", "raptix/sandbox@sha256:abc")
        monkeypatch.setenv("RAPTIX_COVERAGE_PROFILE", "web,ad")
        provenance = collect_provenance()
        assert provenance["image_ref"] == "raptix/sandbox@sha256:abc"
        assert provenance["profile"] == "web,ad"
        assert provenance["image_ref_source"] == "RAPTIX_COVERAGE_IMAGE_REF"
