"""Interfaces subsystem boundary (W3).

Future owner of protocol/transport-facing entrypoints:

- ``mcp/`` receives ``mcp_server/`` (transport and protocol code only —
  no business logic),
- ``api/`` receives ``server/`` and suitable runtime-facing API
  entrypoints.

Nothing is imported here yet. Apps never import runtime internals;
plugins touch only SDK + core contracts. Compatibility re-export shims
are added when ownership moves (see
``raptix-repository-architecture.md`` §12 and §32).
"""
