"""Runtime graph host for the IoT domain plugin.

The IoT operator definition and factory live in ``raptix_iot.agent``
(W10); this module only materializes the LangGraph graph for the
``langgraph.json`` runtime entry.
"""

from raptix_iot.agent import create_iot_operator_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_iot_operator_agent()
    __all__.append("graph")
