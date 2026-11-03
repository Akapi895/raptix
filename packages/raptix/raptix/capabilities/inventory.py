"""Coverage inventory (TC-0 of the tool-capability completion plan).

Answers the plan's release question per checkout: does every capability
Raptix advertises have at least one declared, complete execution path —
and which advertised claims have no declared route at all?

The inventory is a **read-only report** over the existing registries:

* the capability catalog (:func:`raptix.capabilities.build_catalog`)
  supplies declared manifests, implementations, and output formats;
* the adapter layer (:func:`raptix.execution.adapters.resolver.default_adapters`)
  says which ``adapter_id``s actually resolve;
* the parser registry (:func:`raptix.knowledge.ingest.registry.default_registry`)
  says which artifact formats normalize into observations;
* the availability evaluator supplies the current health snapshot.

It is deliberately NOT a refactor of those subsystems and never mutates
them. Output rows distinguish artifact-format outputs (no dot — e.g.
``nmap_xml``) from semantic output names (dotted — e.g.
``defense.brief_markdown``); only artifact formats are parser-relevant.

Product/skill claims absent from the catalog are reported as
**undeclared claims** — static, reviewable entries referencing their
source — never invented runtime manifests. Report files go to new
run/evaluation output paths only: :func:`write_coverage_report` refuses
to overwrite the frozen T0 baseline files.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

from raptix_core.types.capability import (
    CapabilityManifest,
    ImplementationKind,
    ImplementationSpec,
)

FROZEN_BASELINE_FILES = ("baseline.jsonl", "assembled_baseline.jsonl")
FROZEN_BASELINE_DIR = ("benchmarks", "suites", "tool_eval", "baseline")

CLAIM_KINDS = (
    "offline_analysis",
    "source_generation",
    "execution_unprovisioned",
    "wording_gap",
    "reproducibility_gap",
)


@dataclass(frozen=True)
class ImplementationRow:
    """One declared implementation and whether its route is registered."""

    id: str
    kind: str
    adapter_id: str | None = None
    executable: str | None = None
    profile: str | None = None
    worker_id: str | None = None
    route: str = ""
    adapter_registered: bool | None = None


@dataclass(frozen=True)
class CapabilityRow:
    """Coverage row for one catalog manifest (plan §4, runtime columns)."""

    capability_id: str
    description: str
    allowed_roles: tuple[str, ...]
    risk_class: str
    implementations: tuple[ImplementationRow, ...] = ()
    output_formats: tuple[str, ...] = ()
    semantic_outputs: tuple[str, ...] = ()
    parser_registered: tuple[tuple[str, bool], ...] = ()
    missing_parsers: tuple[str, ...] = ()
    availability_status: str = "unknown"
    healthy_implementations: tuple[str, ...] = ()


@dataclass(frozen=True)
class UndeclaredClaim:
    """An advertised claim with no declared runtime route (plan §4)."""

    claim: str
    source: str
    kind: str
    note: str

    def __post_init__(self) -> None:
        if self.kind not in CLAIM_KINDS:
            raise ValueError(f"undeclared claim kind {self.kind!r} not in {CLAIM_KINDS}")


def undeclared_claims() -> tuple[UndeclaredClaim, ...]:
    """Product/skill claims that do not map to a declared runtime route.

    Data, not a scanner: every entry cites its source so the release
    report can narrow or profile-gate it (TC-0 work item 5).
    """
    return (
        UndeclaredClaim(
            claim="analyst.fuzz_target executes fuzz campaigns",
            source="execution/tools/research/fuzz.py; docs/architecture/tool-classification.md",
            kind="source_generation",
            note=(
                "Declares classify + harness generation only; no campaign "
                "execution exists and the AFL++ entry reuses the libFuzzer "
                "template. Execution claims need the TC-8b scope decision."
            ),
        ),
        UndeclaredClaim(
            claim="contracts.scan_solidity / contracts.run_foundry_poc",
            source="docs/architecture/tool-classification.md (frozen v2 table)",
            kind="wording_gap",
            note=(
                "Target IDs from the frozen classification, not current "
                "build_catalog() entries. The plugin's tools perform "
                "offline Solidity pattern analysis; do not advertise them "
                "as Slither/Forge execution."
            ),
        ),
        UndeclaredClaim(
            claim="Contracts plugin foundry_*_test runs generated tests",
            source="plugins/contracts/raptix_contracts/{tools,foundry}.py",
            kind="offline_analysis",
            note=(
                "Generates Foundry test source; never compiles or runs "
                "Forge. Valid offline workflow — keep supported "
                "independently of any execution claim (TC-8a)."
            ),
        ),
        UndeclaredClaim(
            claim="PE/credential skills (linpeas, winpeas, pspy, john)",
            source="packages/raptix-skills corpus; infra/containers/sandbox.Dockerfile",
            kind="execution_unprovisioned",
            note=(
                "Skills reference these binaries but the sandbox base "
                "image does not provision them. Target-side resources "
                "need the D3 resource/session ADR (TC-4); John needs "
                "the sandbox-credentials profile (TC-5)."
            ),
        ),
        UndeclaredClaim(
            claim="Web/AD/pivot profile binaries are supported executors",
            source="infra/containers/sandbox.Dockerfile (opt-in profiles)",
            kind="execution_unprovisioned",
            note=(
                "httpx-toolkit/katana/ffuf/nuclei/testssl, netexec/"
                "certipy/evil-winrm, ligolo-ng install via build flags but "
                "have no typed implementations or adapter registrations in "
                "the default resolver (TC-2 item 7)."
            ),
        ),
        UndeclaredClaim(
            claim="Nuclei templates are pinned inputs",
            source="infra/containers/sandbox.Dockerfile",
            kind="reproducibility_gap",
            note="Templates are runtime-fetched, not pinned (TC-3).",
        ),
        UndeclaredClaim(
            claim="BloodHound collection-to-ingest path is verified",
            source="execution/tools/ad/{bloodhound,bhce_client}.py",
            kind="wording_gap",
            note=(
                "Ingest/client code and instructions exist; collector "
                "entrypoint availability and BHCE schema compatibility are "
                "unverified (TC-6)."
            ),
        ),
    )


def _artifact_format_outputs(manifest: CapabilityManifest) -> tuple[str, ...]:
    """Artifact-format outputs (no dot) — the parser-relevant subset."""
    return tuple(output for output in manifest.outputs if "." not in output)


def _implementation_row(
    implementation: ImplementationSpec, adapter_ids: set[str]
) -> ImplementationRow:
    if implementation.kind is ImplementationKind.ADAPTER:
        adapter_registered = (
            (implementation.adapter_id or "") in adapter_ids
            if not (implementation.adapter_id or "").startswith("builtin.")
            else None
        )
        route = (
            f"carrier:{implementation.executable}"
            if ":" in (implementation.executable or "")
            else (f"adapter:{implementation.adapter_id}")
        )
        return ImplementationRow(
            id=implementation.id,
            kind=implementation.kind.value,
            adapter_id=implementation.adapter_id,
            executable=implementation.executable,
            profile=implementation.profile,
            route=route,
            adapter_registered=adapter_registered,
        )
    if implementation.kind is ImplementationKind.WORKER:
        return ImplementationRow(
            id=implementation.id,
            kind=implementation.kind.value,
            worker_id=implementation.worker_id,
            route=f"worker:{implementation.worker_id}",
        )
    return ImplementationRow(
        id=implementation.id,
        kind=implementation.kind.value,
        route=f"{implementation.kind.value}:{implementation.id}",
    )


def build_coverage_inventory(
    *,
    provenance: Mapping[str, Any] | None = None,
    manifests: tuple[CapabilityManifest, ...] | None = None,
    adapter_ids: set[str] | None = None,
    parser_format_ids: set[str] | None = None,
    availability: Any = None,
) -> dict[str, Any]:
    """Build the coverage-inventory report for the current registries.

    All registries default to the live ones (catalog, adapters, parser
    registry, default availability evaluator) and may be injected for
    deterministic tests. The result is plain JSON-safe data.
    """
    from raptix.capabilities.availability import AvailabilityEvaluator
    from raptix.capabilities.catalog import build_catalog
    from raptix.execution.adapters.resolver import default_adapters
    from raptix.knowledge.ingest.registry import default_registry

    resolved_adapters = adapter_ids if adapter_ids is not None else set(default_adapters())
    resolved_parsers = (
        parser_format_ids
        if parser_format_ids is not None
        else {parser.format_id for parser in default_registry().parsers()}
    )
    evaluator = availability or AvailabilityEvaluator()

    rows: list[CapabilityRow] = []
    for manifest in manifests if manifests is not None else build_catalog():
        artifact_formats = _artifact_format_outputs(manifest)
        semantic_outputs = tuple(o for o in manifest.outputs if "." in o)
        missing = tuple(fmt for fmt in artifact_formats if fmt not in resolved_parsers)
        registered = tuple((fmt, fmt in resolved_parsers) for fmt in artifact_formats)
        snapshot = availability_evaluate(evaluator, manifest)
        rows.append(
            CapabilityRow(
                capability_id=str(manifest.id),
                description=manifest.description,
                allowed_roles=tuple(str(role) for role in manifest.allowed_roles),
                risk_class=manifest.risk_class.value,
                implementations=tuple(
                    _implementation_row(implementation, resolved_adapters)
                    for implementation in manifest.implementations
                ),
                output_formats=artifact_formats,
                semantic_outputs=semantic_outputs,
                parser_registered=registered,
                missing_parsers=missing,
                availability_status=snapshot["status"],
                healthy_implementations=snapshot["healthy_implementations"],
            )
        )

    missing_everywhere = sorted({fmt for row in rows for fmt in row.missing_parsers})
    unregistered_adapters = sorted(
        {
            row.adapter_id or ""
            for row in (impl for cap in rows for impl in cap.implementations)
            if row.adapter_registered is False
        }
        - {""}
    )
    return {
        "schema": "raptix.coverage-inventory/1",
        "provenance": dict(provenance) if provenance is not None else collect_provenance(),
        "summary": {
            "manifest_count": len(rows),
            "artifact_formats": sorted({fmt for row in rows for fmt in row.output_formats}),
            "missing_parser_formats": missing_everywhere,
            "unregistered_adapters": unregistered_adapters,
            "undeclared_claims_count": len(undeclared_claims()),
        },
        "capabilities": [asdict(row) for row in rows],
        "undeclared_claims": [asdict(claim) for claim in undeclared_claims()],
    }


def availability_evaluate(evaluator: Any, manifest: CapabilityManifest) -> dict[str, Any]:
    """One availability snapshot as plain data (status + healthy ids)."""
    result = evaluator.evaluate(manifest)
    return {
        "status": result.status.value,
        "healthy_implementations": list(result.healthy_implementations),
    }


def write_coverage_report(path: str | Path, inventory: Mapping[str, Any]) -> Path:
    """Write the report to a NEW run/evaluation output path.

    Refuses to overwrite the frozen T0 baseline files
    (``benchmarks/suites/tool_eval/baseline/{baseline,assembled_baseline}.jsonl``)
    — the inventory never mutates the frozen baseline.
    """
    report_path = Path(path).resolve()
    if (
        report_path.name in FROZEN_BASELINE_FILES
        and report_path.parent.name == FROZEN_BASELINE_DIR[-1]
    ):
        raise ValueError(f"refusing to overwrite the frozen T0 baseline: {report_path}")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(inventory, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    return report_path


def _git_commit() -> dict[str, Any]:
    """Best-effort checkout provenance; failures degrade to 'unknown'."""
    root = next(
        (parent for parent in Path(__file__).resolve().parents if (parent / ".git").exists()),
        None,
    )
    if root is None:
        return {"checkout": "unknown", "dirty": None}
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            cwd=root,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return {"checkout": "unknown", "dirty": None}
    try:
        dirty = bool(
            subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True,
                text=True,
                timeout=10,
                cwd=root,
                check=True,
            ).stdout.strip()
        )
    except (OSError, subprocess.SubprocessError):
        dirty = None
    return {"checkout": commit, "dirty": dirty}


def collect_provenance() -> dict[str, Any]:
    """Best-effort checkout/image/profile provenance for a fresh snapshot.

    Image/profile identity comes from operator-provided environment
    variables (``RAPTIX_COVERAGE_IMAGE_REF`` / ``RAPTIX_COVERAGE_PROFILE``)
    because the report utility cannot inspect a running sandbox itself
    (that is TC-2's placement-aware probe). Absent values are recorded
    as explicitly unknown, never silently dropped.
    """
    provenance: dict[str, Any] = _git_commit()
    image_ref = os.environ.get("RAPTIX_COVERAGE_IMAGE_REF")
    profile = os.environ.get("RAPTIX_COVERAGE_PROFILE")
    provenance["image_ref"] = image_ref if image_ref else "unknown"
    provenance["profile"] = profile if profile else "unknown"
    provenance["image_ref_source"] = "RAPTIX_COVERAGE_IMAGE_REF" if image_ref else "unset"
    provenance["profile_source"] = "RAPTIX_COVERAGE_PROFILE" if profile else "unset"
    return provenance
