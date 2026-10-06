"""Re-export shim â€” see :mod:`raptix.execution.tools.defense.conops`."""

from raptix_defense.edr import (
    _YARA_KV_PATTERN,  # noqa: F401 — shim re-export (tests reach it here)
    _YARA_META_PATTERN,  # noqa: F401 — shim re-export (tests reach it here)
    push_crowdstrike_ioa,
    push_defender_xdr_detection,
)

__all__ = [
    "push_crowdstrike_ioa",
    "push_defender_xdr_detection",
]
