"""Runtime tooling for the tool-optimization initiative.

Wave-scoped runtime helpers that sit between the agent builders
(:mod:`raptix.intelligence.agents`) and the capability runtime
(:mod:`raptix.capabilities`):

* :mod:`raptix.intelligence.tooling.exposure` — Wave T9 shadow-mode
  dynamic tool exposure.
"""

from raptix.intelligence.tooling.exposure import (
    RECOVERY_TOOL_NAMES,
    ExposureResult,
    GraphSnapshot,
    record_exposure_shadow,
    resolve_active_tools,
    summarize_exposure_result,
)

__all__ = [
    "ExposureResult",
    "GraphSnapshot",
    "RECOVERY_TOOL_NAMES",
    "record_exposure_shadow",
    "resolve_active_tools",
    "summarize_exposure_result",
]
