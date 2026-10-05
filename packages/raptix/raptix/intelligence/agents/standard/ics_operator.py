"""Runtime graph host for the ICS domain plugin.

The ICS operator definition and factory live in ``raptix_ics.agent``
(W10); this module only materializes the LangGraph graph for the
``langgraph.json`` runtime entry.
"""

from raptix_ics.agent import create_ics_operator_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_ics_operator_agent()
    __all__.append("graph")
