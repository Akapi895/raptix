"""Runtime graph host for the mobile domain plugin.

The mobile operator definition and factory live in
``raptix_mobile.agent`` (W10); this module only materializes the
LangGraph graph for the ``langgraph.json`` runtime entry.
"""

from raptix_mobile.agent import create_mobile_operator_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_mobile_operator_agent()
    __all__.append("graph")
