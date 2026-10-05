"""Runtime graph host for the reversing domain plugin.

The reverser definition and factory live in ``raptix_reversing.agent``
(W10); this module only materializes the LangGraph graph for the
``langgraph.json`` runtime entry.
"""

from raptix_reversing.agent import create_reverser_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_reverser_agent()
    __all__.append("graph")
