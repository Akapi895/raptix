"""Re-export shim — the Ghidra/r2 recon bridge moved to the reversing plugin.

Wave T13 (domain pluginization): the canonical home of this module is now
``raptix_reversing.ghidra`` (the plugin owns its domain tooling). Every
historical import path keeps working through this shim; new code imports
from the plugin.
"""

from raptix_reversing.ghidra import (
    _GHIDRA_FUNC_KEYS,  # noqa: F401 — shim re-export (tests reach it here)
    _HEADLESS_ANALYSIS_SCRIPT,  # noqa: F401 — shim re-export (tests reach it here)
    GhidraAnalysis,
    GhidraDecompilation,
    GhidraFunction,
    GhidraXref,
    ghidra_analyze_binary,
    ghidra_available,
    ghidra_decompile_function,
    ghidra_get_xrefs,
)

__all__ = [
    "GhidraAnalysis",
    "GhidraDecompilation",
    "GhidraFunction",
    "GhidraXref",
    "ghidra_analyze_binary",
    "ghidra_available",
    "ghidra_decompile_function",
    "ghidra_get_xrefs",
]
