"""``AvailabilityEvaluator`` — answers ONLY "can the system technically
run this?".

Never consults AKG state (that is :class:`CapabilityEligibility`) and
never consults permissions (that is the invocation-time authorization
guard). Availability is executor presence:

* ``ADAPTER`` — probe the declared ``executable``: a bare name probes
  ``PATH`` (sandbox binary); a ``"module:attr"`` path probes an
  in-process carrier by importing the module and requiring the
  attribute (the initial catalog's in-process implementations).
* ``WORKER`` — ``worker_id`` must resolve via the supplied
  ``WorkerRegistry``-shaped callable to a ``WorkerSpec``. At T6 no
  worker registry exists, so the evaluator takes it as an optional
  callable; without one, worker implementations are UNAVAILABLE —
  the frozen T2 invariant ("a worker_id that resolves to no
  WorkerSpec makes the implementation UNAVAILABLE, never an
  unscoped worker").
* ``MCP`` / ``SERVICE`` — probed through the supplied executor-probe
  callable; without one they are UNAVAILABLE (no executor wired yet —
  honesty over optimism).

Aggregation to :class:`CapabilityStatus`: every implementation healthy
→ AVAILABLE; some → PARTIAL; none (or no declared implementations at
all) → UNAVAILABLE. A capability with zero declared implementations is
UNAVAILABLE by the honesty rule — bash is never an implicit path.
"""

from __future__ import annotations

import importlib
import shutil
from collections.abc import Callable
from typing import Protocol

from raptix_core.types.capability import (
    CapabilityAvailability,
    CapabilityId,
    CapabilityManifest,
    CapabilityStatus,
    ImplementationKind,
    ImplementationSpec,
)


class ExecutorProbe(Protocol):
    """Probe one MCP/SERVICE implementation by its spec. Return True
    when the executor is present and healthy."""

    def __call__(self, implementation: ImplementationSpec) -> bool: ...


class WorkerRegistryCheck(Protocol):
    """Resolve one ``worker_id`` to a registered ``WorkerSpec``
    (T10). Return True only when the worker resolves to an explicit
    primitive allowlist."""

    def __call__(self, worker_id: str) -> bool: ...


def _probe_executable(executable: str) -> bool:
    """Probe one ADAPTER carrier: bare name → PATH lookup;
    ``module:attr`` → import + attribute probe."""
    if ":" in executable:
        module_name, _, attr = executable.partition(":")
        if not module_name or not attr:
            return False
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            return False
        return hasattr(module, attr)
    return shutil.which(executable) is not None


class AvailabilityEvaluator:
    """Evaluate :class:`CapabilityAvailability` for manifests.

    Args:
        executable_probe: override for the ADAPTER probe (tests inject
            fakes; production uses :func:`_probe_executable`).
        worker_registry: callable resolving ``worker_id`` → registered
            ``WorkerSpec`` existence. ``None`` (default) marks every
            WORKER implementation unavailable.
        executor_probe: callable probing MCP/SERVICE implementations.
            ``None`` (default) marks them unavailable.
    """

    def __init__(
        self,
        *,
        executable_probe: Callable[[str], bool] | None = None,
        worker_registry: WorkerRegistryCheck | None = None,
        executor_probe: ExecutorProbe | None = None,
    ) -> None:
        self._executable_probe = executable_probe or _probe_executable
        self._worker_registry = worker_registry
        self._executor_probe = executor_probe

    def evaluate(self, manifest: CapabilityManifest) -> CapabilityAvailability:
        healthy = tuple(
            implementation.id
            for implementation in manifest.implementations
            if self._implementation_healthy(implementation)
        )
        if not manifest.implementations:
            status = CapabilityStatus.UNAVAILABLE
        elif len(healthy) == len(manifest.implementations):
            status = CapabilityStatus.AVAILABLE
        elif healthy:
            status = CapabilityStatus.PARTIAL
        else:
            status = CapabilityStatus.UNAVAILABLE
        return CapabilityAvailability(
            capability_id=CapabilityId(str(manifest.id)),
            status=status,
            healthy_implementations=healthy,
        )

    def _implementation_healthy(self, implementation: ImplementationSpec) -> bool:
        if implementation.kind is ImplementationKind.ADAPTER:
            if not implementation.executable:
                return False
            return self._executable_probe(implementation.executable)
        if implementation.kind is ImplementationKind.WORKER:
            if not implementation.worker_id or self._worker_registry is None:
                return False
            return self._worker_registry(implementation.worker_id)
        # MCP / SERVICE: only available when an executor probe is wired
        # and reports healthy — never assumed.
        if self._executor_probe is None:
            return False
        return self._executor_probe(implementation)
