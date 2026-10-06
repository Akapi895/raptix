"""Parser registry for scanner-output artifacts (Wave T3).

Internal service layer — never agent-facing. The former ``kg_ingest_*``
``@tool`` functions now dispatch through :data:`INGEST_REGISTRY` /
:func:`default_registry`; the L2a auto-ingest hook
(``middleware/kg_autoingest.py``) resolves new scanner kinds through it
as well.

Parsers receive ``(artifact, content)`` — never resolve
``artifact.artifact_ref`` as a filesystem path (it may be ``artifact://``,
``s3://``, a database id). See ``docs/tool-optimization-implementation-plan.md``
Wave T3.
"""

from __future__ import annotations

from raptix.knowledge.ingest.materialize import (
    apply_observations,
    observations_to_records,
)
from raptix.knowledge.ingest.registry import (
    SUMMARY_KIND,
    AmbiguousFormatError,
    ArtifactParser,
    ArtifactReader,
    ParseError,
    ParseOutcome,
    ParserRegistry,
    UnknownFormatError,
    default_registry,
)

__all__ = [
    "SUMMARY_KIND",
    "AmbiguousFormatError",
    "ArtifactParser",
    "ArtifactReader",
    "ParseError",
    "ParseOutcome",
    "ParserRegistry",
    "UnknownFormatError",
    "apply_observations",
    "default_registry",
    "observations_to_records",
]
