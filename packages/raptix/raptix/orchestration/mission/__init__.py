"""orchestration.mission — engagement lifecycle and objective tracking.

Owns the stateful middleware that manages engagement context
(``EngagementContextMiddleware``) and operational planning objectives
(``OPPLANMiddleware``). These are subsystem state owners, not
cross-cutting adapters, so they live under orchestration rather than
middleware. See ADR-0040.
"""

from importlib import import_module
from typing import Any


def __getattr__(name: str) -> Any:
    modules = {"EngagementContextMiddleware": "engagement", "OPPLANMiddleware": "opplan"}
    if name not in modules:
        raise AttributeError(name)
    value = getattr(import_module(f"{__name__}.{modules[name]}"), name)
    globals()[name] = value
    return value


__all__ = ["EngagementContextMiddleware", "OPPLANMiddleware"]
