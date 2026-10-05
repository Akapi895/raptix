"""Runtime graph host for the wireless domain plugin.

The wireless operator definition and factory live in
``raptix_wireless.agent`` (W10); this module only materializes the
LangGraph graph for the ``langgraph.json`` runtime entry.
"""

from raptix_wireless.agent import create_wireless_operator_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_wireless_operator_agent()
    __all__.append("graph")
