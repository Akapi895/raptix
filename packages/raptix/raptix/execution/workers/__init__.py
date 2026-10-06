"""Bounded worker execution (Wave T10).

Contracts and the runner for capabilities whose ``ImplementationKind``
is ``WORKER`` — the optional, open-ended path beside the deterministic
adapter resolver:

* :mod:`raptix.execution.workers.spec` — :class:`WorkerSpec` (the
  explicit primitive allowlist the frozen T2 invariant requires) and the
  :class:`WorkerRegistry` that resolves ``ImplementationSpec.worker_id``
  to it. ``resolves`` doubles as the availability check T6's
  ``AvailabilityEvaluator`` consumes.
* :mod:`raptix.execution.workers.runner` — :class:`BoundedWorkerRunner`:
  dispatch, the scoped toolset, ``CompletionSpec``-bounded termination,
  per-step :class:`ExecutionRecord` provenance, and normalization of
  step artifacts through the T3 ``ParserRegistry``.
"""

from raptix.execution.workers.runner import (
    BoundedWorkerRunner,
    PrimitiveBinding,
    PrimitiveOutcome,
    PrimitiveResolver,
    WorkerDispatchError,
    WorkerPlanner,
    WorkerStep,
    WorkerStepContext,
    WorkerStepResult,
)
from raptix.execution.workers.spec import (
    MAX_WORKER_PRIMITIVES,
    UnknownWorkerError,
    WorkerRegistry,
    WorkerSpec,
)

__all__ = [
    "MAX_WORKER_PRIMITIVES",
    "BoundedWorkerRunner",
    "PrimitiveBinding",
    "PrimitiveOutcome",
    "PrimitiveResolver",
    "UnknownWorkerError",
    "WorkerDispatchError",
    "WorkerPlanner",
    "WorkerRegistry",
    "WorkerSpec",
    "WorkerStep",
    "WorkerStepContext",
    "WorkerStepResult",
]
