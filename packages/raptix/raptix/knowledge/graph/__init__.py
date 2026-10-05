"""Engagement-graph subsystem of the knowledge layer.

Moved here from ``middleware/kg_internal`` in W4; ``raptix.middleware``
keeps thin adapter middleware (``kg.py``, ``kg_autoingest.py``,
``tried_edges.py``) and a deprecated re-export shim at
``raptix.middleware.kg_internal`` for compatibility.

Modules under this package are NOT a public plugin surface. External
plugin authors get the engagement-graph contract via
``raptix_core.contracts`` and the agent-facing tools via
``raptix.middleware.KGMiddleware``. Touching anything under
``knowledge/graph/`` directly is unsupported and may break across minor
releases.
"""

from __future__ import annotations
