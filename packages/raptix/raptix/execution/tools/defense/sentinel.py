"""Re-export shim — see :mod:`raptix.execution.tools.defense.conops`."""

from raptix_defense.sentinel import (
    SigmaToKqlError,
    push_analytic_rule,
    sigma_to_kql,
)

__all__ = [
    "SigmaToKqlError",
    "push_analytic_rule",
    "sigma_to_kql",
]
