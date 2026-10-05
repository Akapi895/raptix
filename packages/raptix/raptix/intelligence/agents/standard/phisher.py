"""Runtime graph host for the phishing domain plugin.

The phisher definition and factory live in ``raptix_phishing.agent``
(W10); this module only materializes the LangGraph graph for the
``langgraph.json`` runtime entry.
"""

from raptix_phishing.agent import create_phisher_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_phisher_agent()
    __all__.append("graph")
