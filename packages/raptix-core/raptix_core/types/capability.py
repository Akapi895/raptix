"""Capability contracts — the WHAT/HOW split the runtime resolves against.

Wave T2 of ``docs/tool-optimization-implementation-plan.md``. These types
are the executor-agnostic contract between the planner (decides WHAT —
a :class:`CapabilityRequest`), the runtime resolver (decides HOW — an
:class:`ImplementationSpec`), and the parser/verifier (decides WHAT
HAPPENED — :class:`Observation`). None of this module executes anything;
it only describes shapes the ``raptix`` runtime resolves and the
``raptix-skills`` corpus references by :class:`SkillId`.

Three concerns this module deliberately keeps separate (never conflate
them — see the implementation plan's "Three-way separation" section):

  * **Availability** (:class:`CapabilityAvailability`) — can the system
    technically run this? Executor/profile/health only.
  * **Eligibility** (:class:`CapabilityEligibility`) — does the current
    state make this applicable? Role/phase/graph-requirement only.
  * **Authorization** — is this specific invocation permitted (scope,
    RoE, approval, budget)? Not modeled here; it is a hard runtime guard
    evaluated at invocation time, never a capability-manifest field, and
    never satisfied by exposure/eligibility alone.

Design decisions (frozen after two contract reviews — do not relax
without re-reviewing the same points):

  * No ``RequirementSpec.query`` — this package must not couple to the
    AKG/Cypher backend. A runtime ``RequirementEvaluator`` decides HOW to
    check each requirement id.
  * ``ImplementationKind`` replaces a coarse ``interactive: bool`` — one
    capability can declare both an ``ADAPTER`` and a ``WORKER``
    implementation.
  * ``ExecutorKind`` generalizes past CLI — MCP/browser/session/service
    execution paths are first-class even before every kind has a real
    executor.
  * ``CompletionSpec.max_steps`` is REQUIRED, not optional. A success/
    failure *observation* condition is an early-exit signal layered on
    top of that hard bound, never a substitute for it — a
    ``CompletionSpec`` built from only a success observation that never
    fires would let a worker run forever. ``CompletionSpec`` is itself
    mandatory whenever a capability declares a ``WORKER`` implementation
    (enforced in :meth:`CapabilityManifest.__post_init__`).
  * ``ExecutionSpec.implementation_id`` is REQUIRED — the field the
    second review found missing. Without it, two implementations of the
    same capability that both happen to run through
    ``ExecutorKind.COMMAND`` (e.g. ``ad.netexec.smb`` vs
    ``ad.impacket.psexec`` under ``access.move_laterally``) are
    indistinguishable in the provenance chain once execution starts. The
    adapter/resolver that builds an ``ExecutionSpec`` MUST copy the
    ``ImplementationSpec.id`` it resolved into this field.
  * ``CapabilityResult.executions`` is a tuple of :class:`ExecutionRecord`,
    not a single ``ExecutionSpec | None`` — a bounded ``WORKER``
    implementation can run several executions per request (e.g.
    ``curl`` → research → PoC → ``bash``), and each one's artifacts need
    to stay attributed to the execution that produced them.
  * ``Mapping[str, JsonValue]`` (not ``dict``) on every payload-shaped
    field — the type signals read-only intent; this package does not
    additionally wrap values in ``MappingProxyType`` at construction, so
    a caller that hands in a mutable ``dict`` is still trusted not to
    mutate it afterward.
  * ``Artifact.artifact_ref`` (not ``path``) — a stable ``ArtifactStore``
    reference; the physical path is a store implementation detail that
    does not survive across containers. **T3 implication**: a Parser
    must never treat ``artifact_ref`` as a filesystem path (e.g.
    ``Path(artifact.artifact_ref).read_text()``) — it may be
    ``artifact://``, ``s3://``, a database id, or a container-crossing
    reference. The registry reads the artifact via an ``ArtifactReader``/
    ``ArtifactStore`` and hands the parser *content*, not a ref to resolve
    itself; the parser must stay storage-backend-agnostic.
  * Skill references use a logical :class:`SkillId` resolved by the
    skill registry — never a file path that breaks on move.
  * ``CapabilityManifest.allowed_roles == ()`` means **unrestricted**
    (every role), matching ``PluginBundle.roles``' existing convention in
    ``raptix_core.plugin_loader`` — not "no roles allowed". A capability
    manifest built with the default is reachable by every role, not
    inaccessible to all of them.
  * A ``WORKER`` ``ImplementationSpec`` declares only ``worker_id`` here;
    the scoped-toolset allowlist is NOT a manifest field.
    ``worker_id`` MUST resolve (via T10's ``WorkerRegistry``) to a
    ``WorkerSpec`` carrying an explicit primitive allowlist — a
    ``worker_id`` that resolves to no such ``WorkerSpec`` makes that
    implementation UNAVAILABLE, never a worker with an implicit/unscoped
    toolset. This invariant is documented here ahead of T10 specifically
    so T10 does not have to break this contract to add it.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum

type JsonValue = str | int | float | bool | None | list[JsonValue] | dict[str, JsonValue]


class CapabilityId(str):
    """Logical, dotted capability name (e.g. ``"network.scan"``). See the
    implementation plan's "Tool naming convention" section for the
    namespace list."""


class SkillId(str):
    """Logical skill identifier (e.g. ``"ad.credential_reuse.netexec"``),
    resolved by the skill registry — never a ``SKILL.md`` file path."""


class RoleId(str):
    """Agent role name (e.g. ``"recon"``, ``"analyst"``)."""


class RiskClass(Enum):
    """How much blast radius a capability's implementations can have."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


# ── Requirements (Eligibility inputs) ───────────────────────────────────


class RequirementKind(Enum):
    GRAPH_NODE = "graph_node"
    GRAPH_EDGE = "graph_edge"
    CREDENTIAL = "credential"
    SERVICE = "service"
    SESSION = "session"
    CUSTOM = "custom"


@dataclass(frozen=True)
class RequirementSpec:
    """One precondition a runtime ``RequirementEvaluator`` checks.

    No ``query`` field by design — see the module docstring. ``id`` is the
    evaluator lookup key (e.g. ``"credential.available"``); the runtime
    decides whether that means a graph query, a state lookup, or
    something else.
    """

    id: str
    kind: RequirementKind
    description: str

    def __post_init__(self) -> None:
        if not self.id or not self.description:
            raise ValueError("RequirementSpec needs a non-empty id and description")


# ── Implementations (the declared HOW) ──────────────────────────────────


class ImplementationKind(Enum):
    ADAPTER = "adapter"  # deterministic: adapter builds the executor payload
    WORKER = "worker"  # bounded LLM worker with a scoped toolset
    MCP = "mcp"  # MCP server/sidecar
    SERVICE = "service"  # long-lived sidecar (BloodHound, Sliver, ...)


@dataclass(frozen=True)
class ImplementationSpec:
    """One way a capability can actually run.

    Field requirements depend on ``kind`` (enforced in
    :meth:`__post_init__`, not by separate subclasses, so a
    ``CapabilityManifest.implementations`` tuple can mix kinds freely):
    ``ADAPTER`` needs ``adapter_id`` + ``executable``; ``WORKER`` needs
    ``worker_id``. ``MCP``/``SERVICE`` carry no required extra field here
    — the MCP server id / service name lives on ``id`` itself.

    A ``WORKER``'s scoped-toolset allowlist is deliberately NOT a field
    here. ``worker_id`` MUST resolve, via T10's ``WorkerRegistry``, to a
    ``WorkerSpec`` carrying an explicit primitive allowlist; a
    ``worker_id`` with no such ``WorkerSpec`` makes this implementation
    UNAVAILABLE — never a worker running with an implicit/unscoped
    toolset.
    """

    id: str
    kind: ImplementationKind

    # ADAPTER kind:
    adapter_id: str | None = None
    executable: str | None = None  # binary name, for availability checks
    profile: str | None = None  # sandbox profile that provides ``executable``

    # WORKER kind:
    worker_id: str | None = None

    version_constraint: str | None = None

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("ImplementationSpec needs a non-empty id")
        if self.kind is ImplementationKind.ADAPTER and not (self.adapter_id and self.executable):
            raise ValueError(
                f"ImplementationSpec {self.id!r}: ADAPTER kind requires adapter_id and executable"
            )
        if self.kind is ImplementationKind.WORKER and not self.worker_id:
            raise ValueError(f"ImplementationSpec {self.id!r}: WORKER kind requires worker_id")


# ── Completion (bounded worker termination) ─────────────────────────────


@dataclass(frozen=True)
class CompletionSpec:
    """Termination criteria for a ``WORKER`` implementation.

    ``max_steps`` is the hard resource bound and is REQUIRED — a worker
    cannot be genuinely open-ended. ``success_observations`` /
    ``failure_conditions`` are early-exit signals layered on top of that
    bound, never a substitute for it: a condition that never fires must
    not let the worker run forever, so a ``CompletionSpec`` with no
    ``max_steps`` was rejected even when it carried a success observation
    (fixed after a review caught this — the step budget is the only
    guarantee that actually terminates the worker).
    """

    max_steps: int
    success_observations: tuple[str, ...] = ()
    failure_conditions: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.max_steps < 1:
            raise ValueError("CompletionSpec.max_steps must be positive")


# ── Manifest (the capability catalog entry) ─────────────────────────────


@dataclass(frozen=True)
class CapabilityManifest:
    """One entry in the global capability catalog.

    ``phase_affinity`` is a SOFT ranking signal (more relevant in these
    UKC phases, ranked higher in exposure) — it must never be used as a
    hard filter. ``allowed_phases`` is the HARD constraint (``None`` =
    valid in every phase; use sparingly, see the implementation plan's
    "UKC phase semantics" section).

    ``allowed_roles == ()`` means UNRESTRICTED (every role), matching
    ``PluginBundle.roles``'s existing convention in
    ``raptix_core.plugin_loader`` ("empty tuple = unrestricted") — not
    "no roles allowed". A manifest built with the default is reachable
    by every role.
    """

    id: CapabilityId
    schema_version: int
    description: str

    phase_affinity: tuple[str, ...] = ()
    allowed_phases: tuple[str, ...] | None = None
    allowed_roles: tuple[RoleId, ...] = ()

    requirements: tuple[RequirementSpec, ...] = ()
    implementations: tuple[ImplementationSpec, ...] = ()
    outputs: tuple[str, ...] = ()
    completion: CompletionSpec | None = None

    skill_ids: tuple[SkillId, ...] = ()

    risk_class: RiskClass = RiskClass.LOW
    parallel_safe: bool = True

    def __post_init__(self) -> None:
        if not self.id or not self.description:
            raise ValueError("CapabilityManifest needs a non-empty id and description")
        if self.schema_version < 1:
            raise ValueError("CapabilityManifest.schema_version must be >= 1")
        if any(impl.kind is ImplementationKind.WORKER for impl in self.implementations):
            if self.completion is None:
                raise ValueError(
                    f"CapabilityManifest {self.id!r}: a WORKER implementation requires "
                    "a CompletionSpec (completion=...)"
                )


# ── Availability (technical: can the system run this?) ─────────────────


class CapabilityStatus(Enum):
    AVAILABLE = "available"
    PARTIAL = "partial"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class CapabilityAvailability:
    """Answers ONLY "can the system technically run this?" — never state
    (that is :class:`CapabilityEligibility`) and never permission (that is
    the invocation-time Authorization guard, not modeled in this module).
    """

    capability_id: CapabilityId
    status: CapabilityStatus
    healthy_implementations: tuple[str, ...] = ()


# ── Eligibility (state: does current context make this applicable?) ────


@dataclass(frozen=True)
class CapabilityEligibility:
    capability_id: CapabilityId
    eligible: bool
    unmet_requirements: tuple[str, ...] = ()
    reason: str | None = None


# ── Request / Execution / Result ────────────────────────────────────────


@dataclass(frozen=True)
class CapabilityRequest:
    """What the planner/worker hands the resolver: WHAT, not HOW."""

    capability_id: CapabilityId
    parameters: Mapping[str, JsonValue] = field(default_factory=dict)
    context: Mapping[str, JsonValue] = field(default_factory=dict)


class ExecutorKind(Enum):
    COMMAND = "command"
    MCP = "mcp"
    BROWSER = "browser"
    SESSION = "session"
    SERVICE = "service"


@dataclass(frozen=True)
class ExecutionSpec:
    """What an adapter hands the executor. ``payload`` is executor-specific
    — e.g. an argv list for ``COMMAND``, a tool-call body for ``MCP`` —
    deliberately not typed further here so this stays executor-agnostic.

    ``implementation_id`` MUST be the ``ImplementationSpec.id`` the
    adapter/resolver resolved to build this spec. Without it, two
    implementations of the same capability that both happen to run
    through the same ``ExecutorKind`` (e.g. ``ad.netexec.smb`` vs
    ``ad.impacket.psexec`` under ``access.move_laterally``, both
    ``ExecutorKind.COMMAND``) are indistinguishable once the provenance
    chain reaches execution.
    """

    implementation_id: str
    executor_kind: ExecutorKind
    executor_id: str
    payload: Mapping[str, JsonValue] = field(default_factory=dict)
    expected_artifact_formats: tuple[str, ...] = ()
    timeout_seconds: int | None = None

    def __post_init__(self) -> None:
        if not self.implementation_id:
            raise ValueError("ExecutionSpec needs a non-empty implementation_id")
        if not self.executor_id:
            raise ValueError("ExecutionSpec needs a non-empty executor_id")
        if self.timeout_seconds is not None and self.timeout_seconds < 1:
            raise ValueError("ExecutionSpec.timeout_seconds must be positive when set")


@dataclass(frozen=True)
class Artifact:
    """A raw executor output, referenced (never by raw filesystem path) so
    it survives across containers and store migrations."""

    id: str
    artifact_ref: str
    format_hint: str | None = None
    content_type: str | None = None
    sha256: str | None = None
    producer: str | None = None
    metadata: Mapping[str, JsonValue] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id or not self.artifact_ref:
            raise ValueError("Artifact needs a non-empty id and artifact_ref")


@dataclass(frozen=True)
class Observation:
    """One normalized fact a Parser/Normalizer produced from an
    :class:`Artifact` — the sole currency the Verifier/AKG consumes."""

    kind: str
    data: Mapping[str, JsonValue] = field(default_factory=dict)
    source_artifact_id: str | None = None
    parser_id: str | None = None
    confidence: float = 1.0

    def __post_init__(self) -> None:
        if not self.kind:
            raise ValueError("Observation needs a non-empty kind")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("Observation.confidence must be within [0.0, 1.0]")


@dataclass(frozen=True)
class ExecutionRecord:
    """One completed execution and the artifacts it produced.

    A single :class:`CapabilityRequest` can produce more than one of
    these — a bounded ``WORKER`` implementation runs several executions
    per request (e.g. ``curl`` → research → PoC → ``bash``), and each
    one's artifacts must stay attributed to the execution that produced
    them rather than pooling into one undifferentiated list. ``spec``
    already carries ``implementation_id`` (see :class:`ExecutionSpec`),
    so it is not duplicated here.
    """

    spec: ExecutionSpec
    artifacts: tuple[Artifact, ...] = ()
    success: bool = False
    error: str | None = None


@dataclass(frozen=True)
class CapabilityResult:
    """The full round-trip record: request → zero or more executions →
    observations → outcome. ``executions`` is empty for a capability that
    resolved without running any executor (e.g. a pure read)."""

    request: CapabilityRequest
    executions: tuple[ExecutionRecord, ...] = ()
    observations: tuple[Observation, ...] = ()
    success: bool = False
    error: str | None = None
