"""Capability catalog + evaluators (Wave T6).

Runtime instantiation of the frozen ``raptix_core.types.capability``
contracts: the initial manifest catalog for the T1-classified semantic
capabilities, a queryable registry, and the three-way separation the
plan mandates — availability (executor presence) and eligibility
(role/phase/requirements) are evaluated by separate components and
exposed as separate result types. Authorization remains the
invocation-time guard and lives elsewhere by design.

Adapters for real executors land in T7 (``execution/adapters/``);
bounded workers in T10; this package only declares and evaluates.
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
from raptix.execution.capabilities.provenance import build_execution_provenance
from raptix.execution.capabilities.registry import (
    CapabilityRegistry,
    UnknownCapabilityError,
    health_check,
)

__all__ = [
    "AvailabilityEvaluator",
    "CapabilityRegistry",
    "EligibilityEvaluator",
    "ExecutorProbe",
    "RequirementEvaluator",
    "UnknownCapabilityError",
    "WorkerRegistryCheck",
    "build_catalog",
    "build_execution_provenance",
    "health_check",
]
