"""Compatibility graph host for the cloud domain plugin (W10)."""

from raptix_cloud.agent import DEFINITION, SUBAGENT_SPEC
from raptix_cloud.agent import create_cloud_hunter_agent as create_cloud_hunter_agent

from raptix.intelligence.agents.domain_composer import domain_baseline_tools
from raptix_core.plugin_loader import is_bundle_enabled

_ROLE = DEFINITION.role
_RECURSION_LIMIT = DEFINITION.recursion_limit
_STANDARD_TOOLS = domain_baseline_tools(DEFINITION)

__all__ = ["SUBAGENT_SPEC", "create_cloud_hunter_agent"]

if is_bundle_enabled("standard"):
    graph = create_cloud_hunter_agent()
    __all__.append("graph")
