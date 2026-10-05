"""Runtime graph host for the Active Directory domain plugin.

The AD operator definition and factory live in
``raptix_active_directory.agent`` (W10); this module only materializes
the LangGraph graph for the ``langgraph.json`` runtime entry.
"""

from raptix_active_directory.agent import create_ad_operator_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_ad_operator_agent()
    __all__.append("graph")
