"""Content-based artifact parser registry (Wave T3 of the tool-optimization
implementation plan).

The :class:`ParserRegistry` is the single resolution point that turns raw
scanner-output bytes into :class:`~raptix_core.types.capability.Observation`
streams. It replaces agent-facing ``kg_ingest_*`` tool dispatch: parsers are
internal services an LLM never chooses.

Design constraints inherited from the T2 contract review:

  * ``Artifact.artifact_ref`` is opaque — it may be ``artifact://``,
    ``s3://``, a database id, or any other cross-container reference. The
    registry never treats it as a filesystem path; callers hand in the
    *content* (read via an :class:`ArtifactReader` or their own transport)
    and parsers receive ``(artifact, content)`` only.
  * Resolution is deterministic: explicit expected formats first, then the
    artifact's format hint, then content sniffing — and a sniffing tie is a
    hard error, never a silent pick.
  * Parsers are pure and idempotent: the same artifact content and metadata
    produce the same observations, with no clock, randomness, or I/O.

Parser output is a list of observations whose ``kind`` is either a
``raptix_core.types.kg.NodeKind`` value (data carries ``key`` / ``label`` /
``props`` / optional ``edges_out`` — the same node-plus-outgoing-edges shape
``KGStore.record_observations`` consumes) or ``parse.summary`` (per-format
counters, consumed by callers and skipped by materializers).
"""

from __future__ import annotations

import threading
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from raptix_core.types.capability import Artifact, Observation

SUMMARY_KIND = "parse.summary"


class ParseError(Exception):
    """Raised by a parser when well-identified content fails to parse.

    The message is user-facing (tool responses surface it verbatim), so
    parsers keep the historical per-format wording, e.g.
    ``"failed to parse masscan json: ..."``.
    """


class UnknownFormatError(ValueError):
    """No registered parser claims the content (or the expected format id
    is not registered). Never fall back to a guess."""


class AmbiguousFormatError(ValueError):
    """Sniffing found two or more parsers with the same top confidence —
    deterministic rejection instead of a silent pick."""

    def __init__(self, format_ids: Sequence[str]) -> None:
        self.format_ids = tuple(sorted(format_ids))
        super().__init__("ambiguous artifact format; candidates: " + ", ".join(self.format_ids))


@runtime_checkable
class ArtifactParser(Protocol):
    """A pure content parser for one output format.

    ``supports`` sniffs bounded content and returns a confidence in
    ``[0.0, 1.0]`` (0.0 = not this format). ``parse`` receives content the
    registry (or the caller) already materialized — never resolve
    ``artifact.artifact_ref`` as a filesystem path.
    """

    format_id: str
    parser_version: str

    def supports(self, artifact: Artifact, content: bytes) -> float: ...

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]: ...


@runtime_checkable
class ArtifactReader(Protocol):
    """Storage-agnostic artifact content source (ArtifactStore today or
    tomorrow). Implementations resolve ``artifact.artifact_ref`` — parsers
    and the registry resolution logic never do."""

    def read(self, artifact: Artifact) -> bytes: ...


@dataclass(frozen=True)
class ParseOutcome:
    """Result of parsing one artifact: the observations plus the resolved
    parser's provenance and the parser-emitted summary counters."""

    observations: tuple[Observation, ...] = ()
    summary: dict[str, Any] = field(default_factory=dict)
    format_id: str = ""
    parser_version: str = ""


def _validated(parser: Any) -> ArtifactParser:
    format_id = getattr(parser, "format_id", None)
    if not isinstance(format_id, str) or not format_id:
        raise ValueError("parser needs a non-empty format_id")
    if not callable(getattr(parser, "supports", None)) or not callable(
        getattr(parser, "parse", None)
    ):
        raise ValueError(f"parser {format_id!r} needs callable supports() and parse()")
    return parser


class ParserRegistry:
    """Deterministic format-id / sniffing resolver over registered parsers.

    Resolution order (frozen by the implementation plan):

      1. ``expected_formats`` (execution metadata / adapter
         ``expected_artifact_formats``) — the first id with a registered
         parser wins; a listed id with no parser is an error, never a
         silent fallthrough to sniffing.
      2. ``artifact.format_hint`` — exact ``format_id`` match.
      3. Content sniffing — every parser scores ``supports``; the strictly
         highest confidence wins; a tie at the top raises
         :class:`AmbiguousFormatError`.
      4. Nothing matched — :class:`UnknownFormatError`.

    Parsers are kept sorted by ``format_id`` so iteration (and therefore
    tie detection) is independent of registration order.
    """

    def __init__(self) -> None:
        self._parsers: dict[str, ArtifactParser] = {}

    def register(self, parser: ArtifactParser) -> None:
        _validated(parser)
        self._parsers[parser.format_id] = parser

    def parsers(self) -> tuple[ArtifactParser, ...]:
        return tuple(self._parsers[key] for key in sorted(self._parsers))

    def get(self, format_id: str) -> ArtifactParser | None:
        return self._parsers.get(format_id)

    def resolve(
        self,
        artifact: Artifact,
        content: bytes,
        *,
        expected_formats: Sequence[str] = (),
    ) -> ArtifactParser:
        missing: list[str] = []
        for format_id in expected_formats:
            parser = self._parsers.get(format_id)
            if parser is not None:
                return parser
            missing.append(format_id)
        if missing:
            if len(missing) == 1:
                raise UnknownFormatError(f"expected format {missing[0]!r} has no registered parser")
            raise UnknownFormatError(
                f"none of the expected formats {missing!r} has a registered parser"
            )
        hint = artifact.format_hint
        if hint:
            parser = self._parsers.get(hint)
            if parser is not None:
                return parser
            raise UnknownFormatError(f"format hint {hint!r} has no registered parser")
        scored = sorted(
            ((parser.supports(artifact, content), parser) for parser in self.parsers()),
            key=lambda pair: (-pair[0], pair[1].format_id),
        )
        if not scored:
            raise UnknownFormatError(f"no parser recognizes the content (artifact {artifact.id!r})")
        best_score, best = scored[0]
        if best_score <= 0.0:
            raise UnknownFormatError(f"no parser recognizes the content (artifact {artifact.id!r})")
        tied = [candidate.format_id for score, candidate in scored if score == best_score]
        if len(tied) > 1:
            raise AmbiguousFormatError(tied)
        return best

    def parse(
        self,
        artifact: Artifact,
        content: bytes,
        *,
        expected_formats: Sequence[str] = (),
    ) -> ParseOutcome:
        parser = self.resolve(artifact, content, expected_formats=expected_formats)
        return self._run(parser, artifact, content)

    def parse_artifact(self, artifact: Artifact, reader: ArtifactReader) -> ParseOutcome:
        """Read content through ``reader`` (never via ``artifact_ref``) and
        parse it — the T2-mandated storage-agnostic path."""
        content = reader.read(artifact)
        return self._run(self.resolve(artifact, content), artifact, content)

    def _run(self, parser: ArtifactParser, artifact: Artifact, content: bytes) -> ParseOutcome:
        observations: list[Observation] = []
        summary: dict[str, Any] = {}
        for observation in parser.parse(artifact, content):
            if observation.kind == SUMMARY_KIND:
                summary = dict(observation.data)
                continue
            observations.append(observation)
        stamped = tuple(
            observation
            if observation.parser_id is not None and observation.source_artifact_id is not None
            else _stamp(observation, parser.format_id, artifact.id)
            for observation in observations
        )
        return ParseOutcome(
            observations=stamped,
            summary=summary,
            format_id=parser.format_id,
            parser_version=parser.parser_version,
        )


def _stamp(observation: Observation, format_id: str, artifact_id: str) -> Observation:
    return Observation(
        kind=observation.kind,
        data=observation.data,
        source_artifact_id=observation.source_artifact_id or artifact_id,
        parser_id=observation.parser_id or format_id,
        confidence=observation.confidence,
    )


_DEFAULT: ParserRegistry | None = None
_DEFAULT_LOCK = threading.Lock()


def default_registry() -> ParserRegistry:
    """Process-wide registry with every built-in parser registered."""
    global _DEFAULT
    if _DEFAULT is None:
        with _DEFAULT_LOCK:
            if _DEFAULT is None:
                from raptix.knowledge.ingest.parsers import register_default_parsers

                registry = ParserRegistry()
                register_default_parsers(registry)
                _DEFAULT = registry
    return _DEFAULT


def iter_node_observations(observations: Iterable[Observation]) -> Iterable[Observation]:
    """Observations carrying graph writes (everything except summaries)."""
    return (observation for observation in observations if observation.kind != SUMMARY_KIND)
