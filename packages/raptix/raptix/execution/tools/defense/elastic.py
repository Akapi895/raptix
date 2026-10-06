"""Re-export shim — see :mod:`raptix.execution.tools.defense.conops`."""

from raptix_defense.elastic import (
    SigmaToElasticError,
    push_detection_rule,
    sigma_to_lucene,
)

__all__ = [
    "SigmaToElasticError",
    "push_detection_rule",
    "sigma_to_lucene",
]
