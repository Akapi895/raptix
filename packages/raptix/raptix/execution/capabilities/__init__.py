"""Capability catalog + evaluators (Waves T6 + T7).

Runtime instantiation of the frozen ``raptix_core.types.capability``
contracts: the manifest catalog for the T1-classified semantic
capabilities plus the T7 binary-backed ones, a queryable registry, and
the three-way separation the plan mandates — availability (executor
presence) and eligibility (role/phase/requirements) are evaluated by
separate components and exposed as separate result types.
Authorization remains the invocation-time guard and lives elsewhere by
design.

Real executors live in ``execution/adapters/`` (T7); bounded workers
in T10; this package only declares and evaluates.
"""

from raptix.execution.capabilities.availability import (
    AvailabilityEvaluator,
    ExecutorProbe,
    WorkerRegistryCheck,
)
from raptix.execution.capabilities.catalog import build_catalog
from raptix.execution.capabilities.eligibility import (
    EligibilityEvaluator,
    RequirementEvaluator,
)
from raptix.execution.capabilities.health import (
    CapabilityHealth,
    ImplementationHealth,
    PlacementHealthChecker,
    ProbeFailureReason,
)
from raptix.execution.capabilities.inventory import (
    UndeclaredClaim,
    build_coverage_inventory,
    collect_provenance,
    undeclared_claims,
    write_coverage_report,
)
from raptix.execution.capabilities.provenance import build_execution_provenance
from raptix.execution.capabilities.registry import (
    CapabilityRegistry,
    UnknownCapabilityError,
    health_check,
)
from raptix.execution.capabilities.tool_versions import (
    build_tool_provenance,
    parse_tool_versions_tsv,
    provenance_for_tool,
    tool_version_from_manifest,
)

__all__ = [
    "AvailabilityEvaluator",
    "CapabilityHealth",
    "CapabilityRegistry",
    "EligibilityEvaluator",
    "ExecutorProbe",
    "ImplementationHealth",
    "PlacementHealthChecker",
    "ProbeFailureReason",
    "RequirementEvaluator",
    "UndeclaredClaim",
    "UnknownCapabilityError",
    "WorkerRegistryCheck",
    "build_catalog",
    "build_coverage_inventory",
    "build_execution_provenance",
    "build_tool_provenance",
    "collect_provenance",
    "health_check",
    "parse_tool_versions_tsv",
    "provenance_for_tool",
    "tool_version_from_manifest",
    "undeclared_claims",
    "write_coverage_report",
]
