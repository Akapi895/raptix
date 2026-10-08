"""Runtime graph host for the cloud domain plugin.

The cloud hunter definition and factory live in ``raptix_cloud.agent``
(W10); this module only materializes the LangGraph graph for the
``langgraph.json`` runtime entry.
"""

from raptix_cloud.agent import create_cloud_hunter_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_cloud_hunter_agent()
    __all__.append("graph")
