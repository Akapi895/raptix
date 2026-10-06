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

Design decisions (frozen after a contract review — do not relax without
re-reviewing the same points):

  * No ``RequirementSpec.query`` — this package must not couple to the
    AKG/Cypher backend. A runtime ``RequirementEvaluator`` decides HOW to
    check each requirement id.
  * ``ImplementationKind`` replaces a coarse ``interactive: bool`` — one
    capability can declare both an ``ADAPTER`` and a ``WORKER``
    implementation.
  * ``ExecutorKind`` generalizes past CLI — MCP/browser/session/service
    execution paths are first-class even before every kind has a real
    executor.
  * ``CompletionSpec`` is mandatory whenever a capability declares a
    ``WORKER`` implementation (enforced in :meth:`CapabilityManifest.__post_init__`)
    — without a bounded termination criterion a worker degenerates into
    an unbounded mini-agent.
  * ``Mapping[str, JsonValue]`` (not ``dict``) on every payload-shaped
    field — the type signals read-only intent; this package does not
    additionally wrap values in ``MappingProxyType`` at construction, so
    a caller that hands in a mutable ``dict`` is still trusted not to
    mutate it afterward.
  * ``Artifact.artifact_ref`` (not ``path``) — a stable ``ArtifactStore``
    reference; the physical path is a store implementation detail that
    does not survive across containers.
  * Skill references use a logical :class:`SkillId` resolved by the
    skill registry — never a file path that breaks on move.
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

    At least one bound is required — ``max_steps``, or a non-empty
    ``success_observations``/``failure_conditions`` — so a worker can
    never be genuinely open-ended (the plan's own stated risk: "Worker
    becomes unbounded mini-agent").
    """

    success_observations: tuple[str, ...] = ()
    failure_conditions: tuple[str, ...] = ()
    max_steps: int | None = None

    def __post_init__(self) -> None:
        if self.max_steps is not None and self.max_steps < 1:
            raise ValueError("CompletionSpec.max_steps must be positive when set")
        if self.max_steps is None and not self.success_observations and not self.failure_conditions:
            raise ValueError(
                "CompletionSpec needs max_steps or at least one success/failure condition"
            )


# ── Manifest (the capability catalog entry) ─────────────────────────────


@dataclass(frozen=True)
class CapabilityManifest:
    """One entry in the global capability catalog.

    ``phase_affinity`` is a SOFT ranking signal (more relevant in these
    UKC phases, ranked higher in exposure) — it must never be used as a
    hard filter. ``allowed_phases`` is the HARD constraint (``None`` =
    valid in every phase; use sparingly, see the implementation plan's
    "UKC phase semantics" section).
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
    """

    executor_kind: ExecutorKind
    executor_id: str
    payload: Mapping[str, JsonValue] = field(default_factory=dict)
    expected_artifact_formats: tuple[str, ...] = ()
    timeout_seconds: int | None = None

    def __post_init__(self) -> None:
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
class CapabilityResult:
    """The full round-trip record: request → (maybe) execution → artifacts
    → observations → outcome. ``execution`` is ``None`` for a capability
    that resolved without running an executor (e.g. a pure read)."""

    request: CapabilityRequest
    execution: ExecutionSpec | None
    artifacts: tuple[Artifact, ...] = ()
    observations: tuple[Observation, ...] = ()
    success: bool = False
    error: str | None = None
