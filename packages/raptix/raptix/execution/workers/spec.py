"""Worker contracts for bounded workers (Wave T10).

The frozen T2 invariant, honored here — never redesigned: a ``WORKER``
``ImplementationSpec`` declares only ``worker_id``; the scoped-toolset
allowlist is NOT a manifest field. ``worker_id`` MUST resolve, via the
:class:`WorkerRegistry`, to a :class:`WorkerSpec` carrying an explicit
primitive allowlist — a ``worker_id`` that resolves to no such
:class:`WorkerSpec` makes that implementation UNAVAILABLE, never a
worker running with an implicit/unscoped toolset.

Model policy and an optional (narrowing-only) step budget live on the
:class:`WorkerSpec` too, per the implementation plan's T10 sketch; the
manifest's ``CompletionSpec.max_steps`` stays the hard bound a
:class:`WorkerSpec` can never extend.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass

MAX_WORKER_PRIMITIVES = 10


class UnknownWorkerError(KeyError):
    """A ``worker_id`` resolved to no registered :class:`WorkerSpec`."""


@dataclass(frozen=True)
class WorkerSpec:
    """One registered bounded worker: the explicit allowlist + policy.

    ``allowed_primitives`` is the ONLY toolset a worker may touch — the
    runner builds the worker's toolset from exactly these names, and a
    planner step naming anything else fails closed. The plan caps a
    scoped worker toolset at ten primitives.

    ``step_budget`` is optional and can only NARROW the manifest's
    ``CompletionSpec.max_steps`` (the runner takes the minimum) — a
    WorkerSpec can never extend the manifest's hard bound.
    """

    worker_id: str
    allowed_primitives: tuple[str, ...]
    model_policy: str | None = None
    step_budget: int | None = None
    description: str = ""

    def __post_init__(self) -> None:
        if not self.worker_id:
            raise ValueError("WorkerSpec needs a non-empty worker_id")
        if not self.allowed_primitives:
            raise ValueError(
                f"WorkerSpec {self.worker_id!r}: the primitive allowlist must not be empty"
            )
        if len(self.allowed_primitives) > MAX_WORKER_PRIMITIVES:
            raise ValueError(
                f"WorkerSpec {self.worker_id!r}: {len(self.allowed_primitives)} primitives "
                f"exceeds the scoped-toolset cap of {MAX_WORKER_PRIMITIVES}"
            )
        if len(set(self.allowed_primitives)) != len(self.allowed_primitives):
            raise ValueError(f"WorkerSpec {self.worker_id!r}: duplicate primitive names")
        if any(not name for name in self.allowed_primitives):
            raise ValueError(f"WorkerSpec {self.worker_id!r}: primitive names must be non-empty")
        if self.step_budget is not None and self.step_budget < 1:
            raise ValueError("WorkerSpec.step_budget must be positive when set")


class WorkerRegistry:
    """Registry of :class:`WorkerSpec` — the T2 ``WorkerRegistry`` shape.

    Duplicate ``worker_id`` registration is rejected (mirroring
    ``CapabilityRegistry``). :meth:`resolves` doubles as the availability
    check callable T6's ``AvailabilityEvaluator`` consumes via
    ``worker_registry=...``; an unregistered ``worker_id`` therefore makes
    its implementation UNAVAILABLE (the frozen T2 honesty default).
    """

    def __init__(self, specs: Iterable[WorkerSpec] | None = None) -> None:
        self._specs: dict[str, WorkerSpec] = {}
        for spec in specs or ():
            self.register(spec)

    def register(self, spec: WorkerSpec) -> None:
        if spec.worker_id in self._specs:
            raise ValueError(f"WorkerSpec {spec.worker_id!r} registered twice")
        self._specs[spec.worker_id] = spec

    def get(self, worker_id: str) -> WorkerSpec:
        try:
            return self._specs[worker_id]
        except KeyError:
            raise UnknownWorkerError(worker_id) from None

    def resolves(self, worker_id: str) -> bool:
        """``True`` only when ``worker_id`` resolves to a registered
        :class:`WorkerSpec` with an explicit allowlist."""
        return worker_id in self._specs

    def __contains__(self, worker_id: object) -> bool:
        return worker_id in self._specs

    def __len__(self) -> int:
        return len(self._specs)

    def __iter__(self) -> Iterator[WorkerSpec]:
        return iter(self._specs.values())
