"""Skill corpus audit + canonical schema enforcement.

Provides the validator CLI used in Phase 0 cleanup. The same modules
become part of ``raptix.skills.engine.builder`` when Phase 1a lands; they
live here in their own subpackage so the validator can ship and the
corpus can be cleaned before the graph compiler exists.
"""

from raptix.skills.audit.canonical import (
    SUBDOMAIN_LIST_PATH,
    load_canonical_subdomains,
)

__all__ = [
    "SUBDOMAIN_LIST_PATH",
    "load_canonical_subdomains",
]
