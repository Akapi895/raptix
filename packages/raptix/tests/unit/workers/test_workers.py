"""Deterministic tests for the Wave T10 bounded worker execution.

No LLM, no network: the planner is a scripted queue, primitives are
fakes that record their calls, and the end-to-end test drives the real
T3 ``ParserRegistry`` over canned nmap XML. Pins the frozen T2 worker
invariant (an unregistered ``worker_id`` is UNAVAILABLE, never an
unscoped toolset) and the four T10 acceptance behaviors: dispatch,
scoped toolset, ``CompletionSpec``-bounded termination, and standard
normalization.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping, Sequence
from types import SimpleNamespace
from typing import Any

import pytest

from raptix.capabilities import AvailabilityEvaluator
from raptix.execution.workers import (
    MAX_WORKER_PRIMITIVES,
    BoundedWorkerRunner,
    PrimitiveBinding,
    PrimitiveOutcome,
    UnknownWorkerError,
    WorkerDispatchError,
    WorkerRegistry,
    WorkerSpec,
    WorkerStep,
    WorkerStepContext,
)
from raptix.knowledge.ingest.registry import (
    ParseOutcome,
    UnknownFormatError,
    default_registry,
    iter_node_observations,
)
from raptix_core.types.capability import (
    Artifact,
    CapabilityId,
    CapabilityManifest,
    CapabilityRequest,
    CompletionSpec,
    ExecutorKind,
    ImplementationKind,
    ImplementationSpec,
    JsonValue,
    Observation,
)

NMAP_XML = b"""<?xml version="1.0"?>
<nmaprun scanner="nmap">
  <host>
    <status state="up"/>
    <address addr="10.0.0.5" addrtype="ipv4"/>
    <hostnames><hostname name="dc01.corp.local"/></hostnames>
    <ports>
      <port protocol="tcp" portid="445">
        <state state="open"/><service name="microsoft-ds"/>
      </port>
      <port protocol="tcp" portid="80">
        <state state="open"/><service name="http" product="nginx"/>
      </port>
    </ports>
  </host>
</nmaprun>
"""


def _request(**params: Any) -> CapabilityRequest:
    return CapabilityRequest(
        capability_id=CapabilityId("exploit.unknown_service"), parameters=params
    )


def _completion(
    max_steps: int = 5,
    success: tuple[str, ...] = ("authentication.success",),
    failure: tuple[str, ...] = (),
) -> CompletionSpec:
    return CompletionSpec(
        max_steps=max_steps, success_observations=success, failure_conditions=failure
    )


def _manifest(
    worker_id: str = "exploit_worker",
    *,
    completion: CompletionSpec | None = None,
    impl_id: str = "exploit.unknown_service.worker",
) -> CapabilityManifest:
    return CapabilityManifest(
        id=CapabilityId("exploit.unknown_service"),
        schema_version=1,
        description="exploit a service whose path cannot be predetermined",
        implementations=(
            ImplementationSpec(id=impl_id, kind=ImplementationKind.WORKER, worker_id=worker_id),
        ),
        completion=completion if completion is not None else _completion(),
        outputs=("authentication.success",),
    )


def _spec(
    worker_id: str = "exploit_worker",
    primitives: tuple[str, ...] = ("bash", "web_search"),
    **kwargs: Any,
) -> WorkerSpec:
    return WorkerSpec(worker_id=worker_id, allowed_primitives=primitives, **kwargs)


class ScriptedPlanner:
    """Returns queued steps, then ``None``; records the contexts it saw."""

    def __init__(self, *steps: WorkerStep | None) -> None:
        self._steps: deque[WorkerStep | None] = deque(steps)
        self.contexts: list[WorkerStepContext] = []

    def next_step(self, context: WorkerStepContext) -> WorkerStep | None:
        self.contexts.append(context)
        return self._steps.popleft() if self._steps else None


class FakeResolver:
    """Serves the injected bindings and records every ``resolve`` call."""

    def __init__(self, **bindings: PrimitiveBinding) -> None:
        self._bindings = bindings
        self.resolved: list[str] = []

    def resolve(self, name: str) -> PrimitiveBinding:
        self.resolved.append(name)
        if name not in self._bindings:
            raise KeyError(name)
        return self._bindings[name]


class FakeParser:
    """Implements the ``ParserRegistry.parse`` shape with canned behavior."""

    def __init__(
        self,
        outcome: ParseOutcome | None = None,
        error: Exception | None = None,
    ) -> None:
        self.calls: list[tuple[Artifact, bytes]] = []
        self._outcome = outcome
        self._error = error

    def parse(
        self, artifact: Artifact, content: bytes, *, expected_formats: Sequence[str] = ()
    ) -> ParseOutcome:
        self.calls.append((artifact, content))
        if self._error is not None:
            error, self._error = self._error, None  # fail once, then serve the outcome
            raise error
        return self._outcome if self._outcome is not None else ParseOutcome()


def _binding(
    name: str,
    *,
    kind: ExecutorKind = ExecutorKind.COMMAND,
    outcomes: list[PrimitiveOutcome] | None = None,
    calls: list[Mapping[str, JsonValue]] | None = None,
) -> PrimitiveBinding:
    queue = deque(outcomes) if outcomes is not None else deque([PrimitiveOutcome(output="ok")])

    def invoke(arguments: Mapping[str, JsonValue]) -> PrimitiveOutcome:
        if calls is not None:
            calls.append(dict(arguments))
        return queue[0] if len(queue) == 1 else queue.popleft()

    return PrimitiveBinding(name=name, executor_kind=kind, invoke=invoke)


def _runner(
    *,
    workers: WorkerRegistry,
    primitives: FakeResolver,
    planner: ScriptedPlanner,
    parser: Any = None,
) -> BoundedWorkerRunner:
    return BoundedWorkerRunner(
        workers=workers, primitives=primitives, planner=planner, parser=parser
    )


# ── WorkerSpec / WorkerRegistry (the frozen T2 invariant) ────────────────


def test_registry_roundtrip_and_dunder() -> None:
    spec = _spec()
    workers = WorkerRegistry([spec])
    assert workers.get("exploit_worker") is spec
    assert "exploit_worker" in workers
    assert len(workers) == 1
    assert list(workers) == [spec]


def test_registry_rejects_duplicate_worker_id() -> None:
    workers = WorkerRegistry([_spec()])
    with pytest.raises(ValueError, match="registered twice"):
        workers.register(_spec())


def test_get_unknown_worker_id_raises() -> None:
    with pytest.raises(UnknownWorkerError):
        WorkerRegistry().get("nope")


def test_worker_spec_validation() -> None:
    with pytest.raises(ValueError, match="non-empty worker_id"):
        _spec(worker_id="")
    with pytest.raises(ValueError, match="must not be empty"):
        _spec(primitives=())
    with pytest.raises(ValueError, match="cap of 10"):
        _spec(primitives=tuple(f"p{i}" for i in range(MAX_WORKER_PRIMITIVES + 1)))
    with pytest.raises(ValueError, match="duplicate"):
        _spec(primitives=("bash", "bash"))
    with pytest.raises(ValueError, match="non-empty"):
        _spec(primitives=("bash", ""))
    with pytest.raises(ValueError, match="positive"):
        _spec(step_budget=0)


def test_unregistered_worker_id_is_unavailable_never_unscoped() -> None:
    """The frozen T2 invariant, end to end through the T6 evaluator:
    ``resolves`` is the availability check; no registration → UNAVAILABLE."""
    manifest = _manifest()
    unavailable = AvailabilityEvaluator(worker_registry=WorkerRegistry().resolves)
    assert unavailable.evaluate(manifest).status.name == "UNAVAILABLE"
    available = AvailabilityEvaluator(worker_registry=WorkerRegistry([_spec()]).resolves)
    assert available.evaluate(manifest).status.name == "AVAILABLE"


# ── Dispatch ─────────────────────────────────────────────────────────────


def test_run_dispatches_to_the_registered_worker() -> None:
    parser = FakeParser(ParseOutcome(observations=(Observation(kind="authentication.success"),)))
    planner = ScriptedPlanner(WorkerStep(primitive="bash", arguments={"cmd": "id"}))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash",
                outcomes=[
                    PrimitiveOutcome(
                        output="ok",
                        artifact=Artifact(id="art-0", artifact_ref="artifact://r/art-0"),
                        artifact_content=b"data",
                    )
                ],
            )
        ),
        planner=planner,
        parser=parser,
    )
    result = runner.run(_request(target="10.0.0.5"), _manifest())
    assert result.success is True
    assert result.error is None
    assert len(result.executions) == 1
    assert result.observations[0].kind == "authentication.success"


def test_run_without_worker_implementation_raises() -> None:
    manifest = SimpleNamespace(
        id=CapabilityId("plain.cap"),
        implementations=(
            ImplementationSpec(
                id="plain.adapter",
                kind=ImplementationKind.ADAPTER,
                adapter_id="a",
                executable="x",
            ),
        ),
        completion=None,
    )  # type: ignore[arg-type]
    planner = ScriptedPlanner()
    runner = _runner(
        workers=WorkerRegistry([_spec()]),
        primitives=FakeResolver(),
        planner=planner,
    )
    with pytest.raises(WorkerDispatchError, match="no WORKER implementation"):
        runner.run(_request(), manifest)  # type: ignore[arg-type]
    assert planner.contexts == []


def test_run_with_unregistered_worker_id_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    planner = ScriptedPlanner(WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry(),  # nothing registered
        primitives=FakeResolver(bash=_binding("bash")),
        planner=planner,
    )
    with pytest.raises(WorkerDispatchError, match="exploit_worker"):
        runner.run(_request(), _manifest())
    assert planner.contexts == []  # never planned a step it could not run


def test_toolset_resolved_exactly_from_the_allowlist() -> None:
    resolver = FakeResolver(bash=_binding("bash"), web_search=_binding("web_search"))
    planner = ScriptedPlanner(None)
    runner = _runner(workers=WorkerRegistry([_spec()]), primitives=resolver, planner=planner)
    runner.run(_request(), _manifest())
    # Both allowlisted primitives resolved, in allowlist order, before the
    # first planner call — the toolset IS the allowlist.
    assert resolver.resolved == ["bash", "web_search"]
    assert planner.contexts[0].toolset == ("bash", "web_search")
    assert planner.contexts[0].remaining_steps == 5


def test_missing_primitive_refuses_to_start() -> None:
    planner = ScriptedPlanner(WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry([_spec()]),
        primitives=FakeResolver(bash=_binding("bash")),  # web_search missing
        planner=planner,
    )
    with pytest.raises(WorkerDispatchError, match="partial toolset"):
        runner.run(_request(), _manifest())
    assert planner.contexts == []


def test_planner_cannot_use_a_non_allowed_primitive() -> None:
    calls: list[Mapping[str, JsonValue]] = []
    planner = ScriptedPlanner(WorkerStep(primitive="rm_rf_all"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(bash=_binding("bash", calls=calls)),
        planner=planner,
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=3)))
    assert result.success is False
    assert result.error is not None and "non-allowed primitive" in result.error
    assert result.executions == ()  # the step never executed
    assert calls == []


# ── Termination (CompletionSpec criteria, never open-ended) ─────────────


def test_max_steps_is_the_hard_bound() -> None:
    planner = ScriptedPlanner(*[WorkerStep(primitive="bash")] * 10)
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(bash=_binding("bash")),
        planner=planner,
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=3)))
    assert len(result.executions) == 3
    assert len(planner.contexts) == 3
    assert result.success is False
    assert result.error is not None and "budget" in result.error


def test_worker_spec_step_budget_only_narrows() -> None:
    planner = ScriptedPlanner(*[WorkerStep(primitive="bash")] * 10)
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",), step_budget=2)]),
        primitives=FakeResolver(bash=_binding("bash")),
        planner=planner,
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=5)))
    assert len(result.executions) == 2
    assert result.error is not None and "budget" in result.error


def test_success_observation_exits_early() -> None:
    parser = FakeParser(ParseOutcome(observations=(Observation(kind="authentication.success"),)))
    planner = ScriptedPlanner(WorkerStep(primitive="bash"), WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash",
                outcomes=[
                    PrimitiveOutcome(output="try 1"),  # no artifact → no observations
                    PrimitiveOutcome(
                        output="try 2",
                        artifact=Artifact(id="art-s", artifact_ref="artifact://r/art-s"),
                        artifact_content=b"payload",
                    ),
                ],
            )
        ),
        planner=planner,
        parser=parser,
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=10)))
    assert result.success is True
    assert len(result.executions) == 2  # stopped at the success signal, not the budget


def test_failure_condition_stops_unsuccessful() -> None:
    parser = FakeParser(ParseOutcome(observations=(Observation(kind="auth.denied"),)))
    planner = ScriptedPlanner(WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash",
                outcomes=[
                    PrimitiveOutcome(
                        artifact=Artifact(id="art-f", artifact_ref="artifact://r/art-f"),
                        artifact_content=b"denied",
                    )
                ],
            )
        ),
        planner=planner,
        parser=parser,
    )
    result = runner.run(
        _request(),
        _manifest(completion=_completion(max_steps=5, failure=("auth.denied",))),
    )
    assert result.success is False
    assert result.error is not None and "auth.denied" in result.error


def test_planner_stopping_counts_as_incomplete() -> None:
    planner = ScriptedPlanner(None)
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(bash=_binding("bash")),
        planner=planner,
    )
    result = runner.run(_request(), _manifest())
    assert result.success is False
    assert result.executions == ()
    assert result.error is not None and "no further steps" in result.error


# ── Normalization + provenance ───────────────────────────────────────────


def test_step_artifact_flows_through_the_real_parser_registry() -> None:
    artifact = Artifact(
        id="art-1",
        artifact_ref="artifact://run-1/art-1",
        format_hint="nmap_xml",
        producer="bash",
    )
    planner = ScriptedPlanner(WorkerStep(primitive="bash", arguments={"cmd": "nmap ..."}))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash",
                outcomes=[
                    PrimitiveOutcome(output="", artifact=artifact, artifact_content=NMAP_XML)
                ],
            )
        ),
        planner=planner,
        parser=default_registry(),
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=3)))
    kinds = {observation.kind for observation in iter_node_observations(result.observations)}
    assert {"Host", "Service", "Entrypoint"} <= kinds
    for observation in iter_node_observations(result.observations):
        assert observation.parser_id == "nmap_xml"
        assert observation.source_artifact_id == "art-1"
    assert result.executions[0].artifacts == (artifact,)


def test_parse_failure_is_recorded_never_silent() -> None:
    # sqlmap_log has a registered parser since TC-1; the recorded-failure
    # intent needs a format the default registry genuinely cannot resolve.
    artifact = Artifact(
        id="art-2", artifact_ref="artifact://run-1/art-2", format_hint="unregistered_format"
    )
    planner = ScriptedPlanner(WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash",
                outcomes=[PrimitiveOutcome(artifact=artifact, artifact_content=b"log")],
            )
        ),
        planner=planner,
        parser=default_registry(),
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=1)))
    assert result.observations == ()
    assert result.executions[0].error is not None
    assert "artifact parsing failed" in str(result.executions[0].error)
    assert "unregistered_format" in str(result.executions[0].error)


def test_parse_failure_lets_the_worker_continue() -> None:
    artifact = Artifact(
        id="art-3", artifact_ref="artifact://run-1/art-3", format_hint="unknown_fmt"
    )
    parser = FakeParser(
        ParseOutcome(observations=(Observation(kind="authentication.success"),)),
        error=UnknownFormatError("unknown_fmt"),
    )
    planner = ScriptedPlanner(WorkerStep(primitive="bash"), WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash",
                outcomes=[
                    PrimitiveOutcome(artifact=artifact, artifact_content=b"x"),
                    PrimitiveOutcome(
                        output="recovered",
                        artifact=Artifact(
                            id="art-3b",
                            artifact_ref="artifact://run-1/art-3b",
                            format_hint="unknown_fmt",
                        ),
                        artifact_content=b"y",
                    ),
                ],
            )
        ),
        planner=planner,
        parser=parser,
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=5)))
    assert len(result.executions) == 2
    assert result.executions[0].success is False
    assert result.executions[1].success is True
    assert result.success is True  # the second step's observation still wins


def test_without_a_parser_normalization_is_skipped_by_the_caller() -> None:
    artifact = Artifact(id="art-4", artifact_ref="artifact://run-1/art-4")
    planner = ScriptedPlanner(WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash", outcomes=[PrimitiveOutcome(artifact=artifact, artifact_content=b"x")]
            )
        ),
        planner=planner,
        parser=None,
    )
    result = runner.run(_request(), _manifest())
    assert result.observations == ()
    assert result.executions[0].artifacts == (artifact,)
    assert result.executions[0].success is True  # skipping is the caller's decision


def test_execution_record_carries_provenance() -> None:
    calls: list[Mapping[str, JsonValue]] = []
    planner = ScriptedPlanner(WorkerStep(primitive="bash", arguments={"cmd": "id"}))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(bash=_binding("bash", kind=ExecutorKind.COMMAND, calls=calls)),
        planner=planner,
    )
    result = runner.run(_request(target="10.0.0.5"), _manifest())
    spec = result.executions[0].spec
    assert spec.implementation_id == "exploit.unknown_service.worker"
    assert spec.executor_kind is ExecutorKind.COMMAND
    assert spec.executor_id == "bash"
    assert spec.payload["primitive"] == "bash"
    assert spec.payload["arguments"] == {"cmd": "id"}
    assert calls == [{"cmd": "id"}]


def test_primitive_exception_is_a_failed_step_not_a_crash() -> None:
    def explode(arguments: Mapping[str, JsonValue]) -> PrimitiveOutcome:
        raise RuntimeError("boom")

    planner = ScriptedPlanner(WorkerStep(primitive="bash"), WorkerStep(primitive="web_search"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash", "web_search"))]),
        primitives=FakeResolver(
            bash=PrimitiveBinding(
                name="bash",
                executor_kind=ExecutorKind.COMMAND,
                invoke=explode,
            ),
            web_search=_binding("web_search"),
        ),
        planner=planner,
    )
    result = runner.run(_request(), _manifest(completion=_completion(max_steps=5, success=())))
    assert len(result.executions) == 2
    assert result.executions[0].success is False
    assert result.executions[0].error is not None
    assert "RuntimeError: boom" in result.executions[0].error
    assert result.executions[1].success is True
    # The planner saw the failure in its history and adapted.
    assert planner.contexts[1].steps_taken[0].success is False


def test_worker_context_history_is_visible_to_the_planner() -> None:
    planner = ScriptedPlanner(WorkerStep(primitive="bash"), WorkerStep(primitive="bash"))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash",))]),
        primitives=FakeResolver(bash=_binding("bash")),
        planner=planner,
    )
    runner.run(_request(), _manifest(completion=_completion(max_steps=4)))
    assert len(planner.contexts[0].steps_taken) == 0
    assert planner.contexts[0].remaining_steps == 4
    assert len(planner.contexts[1].steps_taken) == 1
    assert planner.contexts[1].remaining_steps == 3
    assert planner.contexts[1].steps_taken[0].primitive == "bash"


# ── The catalog's T10 worker capability (exploit.unknown_service) ────────


def test_catalog_worker_capability_matches_plan_example() -> None:
    from raptix.capabilities import build_catalog

    manifest = next(m for m in build_catalog() if str(m.id) == "exploit.unknown_service")
    (impl,) = manifest.implementations
    assert impl.kind is ImplementationKind.WORKER
    assert impl.worker_id == "exploit_worker"
    assert manifest.completion is not None
    # The plan's example pins exactly these bounds: 10 steps and the
    # authentication.success observation as the early-exit signal.
    assert manifest.completion.max_steps == 10
    assert manifest.completion.success_observations == ("authentication.success",)
    assert manifest.completion.failure_conditions == ()


def test_runner_drives_the_catalog_worker_end_to_end() -> None:
    from raptix.capabilities import build_catalog

    manifest = next(m for m in build_catalog() if str(m.id) == "exploit.unknown_service")
    parser = FakeParser(ParseOutcome(observations=(Observation(kind="authentication.success"),)))
    planner = ScriptedPlanner(WorkerStep(primitive="bash", arguments={"cmd": "attempt"}))
    runner = _runner(
        workers=WorkerRegistry([_spec(primitives=("bash", "web_search"))]),
        primitives=FakeResolver(
            bash=_binding(
                "bash",
                outcomes=[
                    PrimitiveOutcome(
                        output="ok",
                        artifact=Artifact(id="art-c", artifact_ref="artifact://r/art-c"),
                        artifact_content=b"data",
                    )
                ],
            ),
            web_search=_binding("web_search"),
        ),
        planner=planner,
        parser=parser,
    )
    result = runner.run(
        CapabilityRequest(
            capability_id=CapabilityId("exploit.unknown_service"),
            parameters={"target": "10.0.0.5"},
        ),
        manifest,
    )
    assert result.success is True
    assert result.executions[0].spec.implementation_id == "exploit.unknown_service.bounded_worker"
    assert result.executions[0].spec.executor_kind is ExecutorKind.COMMAND
    assert result.observations[0].kind == "authentication.success"
    # The step budget came from the catalog's CompletionSpec, not a
    # test-local manifest.
    assert planner.contexts[0].remaining_steps == 10
