"""Bounded worker execution (Wave T10).

Runs ONE ``WORKER`` implementation for one :class:`CapabilityRequest`
under the manifest's :class:`CompletionSpec`:

* the toolset is scoped to exactly ``WorkerSpec.allowed_primitives``
  (≤ ``MAX_WORKER_PRIMITIVES``), resolved up-front — all-or-nothing; a
  missing primitive refuses the start instead of running with a partial
  toolset;
* ``CompletionSpec.max_steps`` is the hard termination bound;
  ``success_observations`` / ``failure_conditions`` are early-exit
  signals layered on top, matched against the observation kinds each
  step produces;
* a planner step naming a primitive outside the allowlist fails closed —
  the worker stops and the step never executes;
* every executed step becomes one :class:`ExecutionRecord` (T2's
  ``CapabilityResult.executions``) with ``implementation_id`` copied from
  the resolved ``ImplementationSpec`` — the provenance chain survives the
  multi-step round trip;
* a step artifact flows through the T3 ``ParserRegistry`` — the standard
  normalization pipeline — before its observations enter the result; a
  parse failure is recorded on the step's record, never a silent skip.

The planner is an injected protocol (:class:`WorkerPlanner`): the real
LLM-backed planner plugs in later without reshaping this loop, and the
deterministic tests inject a scripted one. Executor kinds: a worker step
runs inside the worker session (``ExecutorKind.SESSION``) or as a
sandbox command (``ExecutorKind.COMMAND``) — each primitive binding
declares which. Eligibility and authorization are deliberately NOT
evaluated here; they are the separate state and invocation-time guards.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Protocol

from raptix.execution.workers.spec import WorkerRegistry, WorkerSpec
from raptix.knowledge.ingest.registry import ParserRegistry
from raptix_core.types.capability import (
    Artifact,
    CapabilityManifest,
    CapabilityRequest,
    CapabilityResult,
    ExecutionRecord,
    ExecutionSpec,
    ExecutorKind,
    ImplementationKind,
    ImplementationSpec,
    JsonValue,
    Observation,
)


class WorkerDispatchError(RuntimeError):
    """No ``WORKER`` implementation of the capability could be dispatched."""


@dataclass(frozen=True)
class PrimitiveOutcome:
    """What one primitive invocation returned.

    ``artifact`` + ``artifact_content`` hand the runner a raw output for
    the standard normalization pipeline (the T3 registry parses
    *content*; the artifact ref is never treated as a path).
    """

    output: str = ""
    artifact: Artifact | None = None
    artifact_content: bytes = b""
    success: bool = True
    error: str | None = None


@dataclass(frozen=True)
class PrimitiveBinding:
    """One primitive a worker may call: identity, executor kind, callable."""

    name: str
    executor_kind: ExecutorKind
    invoke: Callable[[Mapping[str, JsonValue]], PrimitiveOutcome]


class PrimitiveResolver(Protocol):
    """Resolves an allowlisted primitive name to its binding.

    Implementations raise a ``KeyError`` (e.g. an ``UnknownPrimitiveError``
    subclass) when the name is unknown — the runner refuses to start with
    a partial toolset rather than dropping the missing primitive.
    """

    def resolve(self, name: str) -> PrimitiveBinding: ...


@dataclass(frozen=True)
class WorkerStep:
    """One planner decision: which allowlisted primitive to call next."""

    primitive: str
    arguments: Mapping[str, JsonValue] = field(default_factory=dict)


@dataclass(frozen=True)
class WorkerStepResult:
    """What happened to one executed step — the planner sees these."""

    primitive: str
    output: str
    observations: tuple[Observation, ...] = ()
    success: bool = True
    error: str | None = None


@dataclass(frozen=True)
class WorkerStepContext:
    """Everything a planner may base its next decision on."""

    request: CapabilityRequest
    toolset: tuple[str, ...]
    steps_taken: tuple[WorkerStepResult, ...]
    remaining_steps: int


class WorkerPlanner(Protocol):
    """Decides the next bounded-worker step; ``None`` ends the run."""

    def next_step(self, context: WorkerStepContext) -> WorkerStep | None: ...


class BoundedWorkerRunner:
    """Dispatch and execute one bounded worker under its ``CompletionSpec``.

    The runner does not hold canonical state (the AKG stays canonical);
    it only assembles the round-trip record for one request.
    """

    def __init__(
        self,
        *,
        workers: WorkerRegistry,
        primitives: PrimitiveResolver,
        planner: WorkerPlanner,
        parser: ParserRegistry | None = None,
    ) -> None:
        self._workers = workers
        self._primitives = primitives
        self._planner = planner
        self._parser = parser

    def run(self, request: CapabilityRequest, manifest: CapabilityManifest) -> CapabilityResult:
        """Dispatch ``manifest``'s WORKER implementation for ``request``.

        Raises:
            WorkerDispatchError: the manifest declares no WORKER
                implementation, no ``worker_id`` resolves to a registered
                :class:`WorkerSpec`, the completion spec is missing, or an
                allowlisted primitive does not resolve.
        """
        implementation = self._resolve_implementation(manifest)
        worker_id = implementation.worker_id
        if worker_id is None:  # unreachable: WORKER impls require worker_id (T2)
            raise WorkerDispatchError(f"implementation {implementation.id!r} has no worker_id")
        spec = self._workers.get(worker_id)
        completion = manifest.completion
        if completion is None:
            raise WorkerDispatchError(
                f"capability {manifest.id!r} declares a WORKER implementation "
                "without a CompletionSpec"
            )
        max_steps = completion.max_steps
        if spec.step_budget is not None:
            # A WorkerSpec may narrow the manifest bound, never extend it.
            max_steps = min(max_steps, spec.step_budget)
        bindings = self._resolve_toolset(spec)

        executions: list[ExecutionRecord] = []
        observations: list[Observation] = []
        history: list[WorkerStepResult] = []
        success = False
        error: str | None = None
        for step_index in range(max_steps):
            context = WorkerStepContext(
                request=request,
                toolset=tuple(spec.allowed_primitives),
                steps_taken=tuple(history),
                remaining_steps=max_steps - step_index,
            )
            step = self._planner.next_step(context)
            if step is None:
                error = "worker planned no further steps before completing"
                break
            if step.primitive not in bindings:
                # Fail closed: a planner that reaches outside its scoped
                # toolset ends the worker; the step never executes.
                error = f"planner requested non-allowed primitive {step.primitive!r}"
                break
            record, step_result, step_observations = self._execute_step(
                implementation_id=implementation.id,
                binding=bindings[step.primitive],
                step=step,
            )
            executions.append(record)
            observations.extend(step_observations)
            history.append(step_result)
            kinds = {observation.kind for observation in step_observations}
            if kinds & set(completion.success_observations):
                success = True
                break
            if kinds & set(completion.failure_conditions):
                error = "failure condition matched: " + ", ".join(
                    sorted(kinds & set(completion.failure_conditions))
                )
                break
        if not success and error is None:
            error = f"step budget exhausted after {max_steps} steps"
        return CapabilityResult(
            request=request,
            executions=tuple(executions),
            observations=tuple(observations),
            success=success,
            error=error,
        )

    def _resolve_implementation(self, manifest: CapabilityManifest) -> ImplementationSpec:
        worker_impls = [
            impl for impl in manifest.implementations if impl.kind is ImplementationKind.WORKER
        ]
        if not worker_impls:
            raise WorkerDispatchError(
                f"capability {manifest.id!r} declares no WORKER implementation"
            )
        for implementation in worker_impls:
            if implementation.worker_id is not None and self._workers.resolves(
                implementation.worker_id
            ):
                return implementation
        raise WorkerDispatchError(
            f"capability {manifest.id!r}: no worker_id resolves to a registered "
            f"WorkerSpec ({', '.join(repr(impl.worker_id) for impl in worker_impls)}) — "
            "never an unscoped fallback"
        )

    def _resolve_toolset(self, spec: WorkerSpec) -> dict[str, PrimitiveBinding]:
        bindings: dict[str, PrimitiveBinding] = {}
        for name in spec.allowed_primitives:
            try:
                bindings[name] = self._primitives.resolve(name)
            except KeyError as exc:
                raise WorkerDispatchError(
                    f"worker {spec.worker_id!r}: allowlisted primitive {name!r} does not "
                    "resolve — refusing to start with a partial toolset"
                ) from exc
        return bindings

    def _execute_step(
        self,
        *,
        implementation_id: str,
        binding: PrimitiveBinding,
        step: WorkerStep,
    ) -> tuple[ExecutionRecord, WorkerStepResult, tuple[Observation, ...]]:
        try:
            outcome = binding.invoke(step.arguments)
        except Exception as exc:  # noqa: BLE001 — a raising primitive is a failed step, not a crash
            outcome = PrimitiveOutcome(
                output="", success=False, error=f"{type(exc).__name__}: {exc}"
            )
        spec = ExecutionSpec(
            implementation_id=implementation_id,
            executor_kind=binding.executor_kind,
            executor_id=binding.name,
            payload={"primitive": binding.name, "arguments": dict(step.arguments)},
        )
        step_success = outcome.success
        error = outcome.error
        step_observations: tuple[Observation, ...] = ()
        if outcome.artifact is not None and self._parser is not None:
            try:
                step_observations = self._parser.parse(
                    outcome.artifact, outcome.artifact_content
                ).observations
            except Exception as exc:  # noqa: BLE001 — a parse failure is the record's error, never a silent skip
                step_success = False
                error = f"artifact parsing failed: {exc}"
        record = ExecutionRecord(
            spec=spec,
            artifacts=(outcome.artifact,) if outcome.artifact is not None else (),
            success=step_success,
            error=error,
        )
        result = WorkerStepResult(
            primitive=binding.name,
            output=outcome.output,
            observations=step_observations,
            success=step_success,
            error=error,
        )
        return record, result, step_observations
