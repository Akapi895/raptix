"""Compatibility graph host for the ICS domain plugin (W10)."""

from raptix_ics.agent import DEFINITION, SUBAGENT_SPEC
from raptix_ics.agent import create_ics_operator_agent as create_ics_operator_agent

from raptix.intelligence.agents.domain_composer import domain_baseline_tools
from raptix_core.plugin_loader import is_bundle_enabled

_ROLE = DEFINITION.role
_RECURSION_LIMIT = DEFINITION.recursion_limit
_SKILL_SOURCES = list(DEFINITION.skill_sources or ())
_STANDARD_TOOLS = domain_baseline_tools(DEFINITION)

__all__ = ["SUBAGENT_SPEC", "create_ics_operator_agent"]

if is_bundle_enabled("standard"):
    graph = create_ics_operator_agent()
    __all__.append("graph")
