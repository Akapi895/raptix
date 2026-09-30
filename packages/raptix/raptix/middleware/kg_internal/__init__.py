"""Internal implementation of the KG middleware.

Modules under this package are NOT a public plugin surface. External
plugin authors get the engagement-graph contract via
``raptix_core.contracts`` and the agent-facing tools via
``raptix.middleware.KGMiddleware``. Touching anything under
``kg_internal/`` directly is unsupported and may break across minor
releases.
"""

from __future__ import annotations
