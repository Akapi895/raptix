"""Framework plumbing: agent-support tool modules with no single attack-surface domain.

Grouped here because each is cross-cutting rather than domain-specific —
unlike ``contracts/`` and ``mcp/`` (the other "framework plumbing" group,
see ``execution/tools/README.md``), these don't share one subsystem, so
this package re-exports nothing; import from the specific submodule:

- ``filesystem``     — filesystem-tool selection helper for middleware
- ``skills``          — the ``load_skill`` agent tool
- ``skills_registry`` — its data-layer counterpart (slug resolution, safety)
- ``verification``    — workspace-first finding verification tool
- ``opplan``          — OPPLAN objective tools (add/get/list/update/expand/collapse)
"""

from __future__ import annotations
