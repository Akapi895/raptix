"""Re-export shim — see :mod:`raptix.execution.tools.defense.conops`."""

from raptix_defense.splunk import (
    SigmaConversionError,
    push_savedsearch,
    sigma_to_spl,
)

__all__ = [
    "SigmaConversionError",
    "push_savedsearch",
    "sigma_to_spl",
]
