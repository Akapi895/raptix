"""Skillogy server: Neo4j-backed REST app for Phase 1a (Amendment v0.2.2).

The legacy in-memory ``SkillRegistry`` and the markdown ``ingest_directory``
helper were removed; their files (``registry.py`` and ``ingest.py``) are
kept for one release as no-import-graph dead code so anyone importing
the old names sees a clean ``ImportError`` from this package instead of
a stale class. The original service design is referenced in
``docs/architecture/skills.md#skillogy``.
"""

from raptix.skills.engine.server.app import build_app
from raptix.skills.engine.server.neo4j_backend import (
    CypherWriteRejected,
    Neo4jBackend,
    assert_read_only,
)

__all__ = ["CypherWriteRejected", "Neo4jBackend", "assert_read_only", "build_app"]
