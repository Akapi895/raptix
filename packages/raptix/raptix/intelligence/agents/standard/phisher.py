"""Compatibility graph host for the phishing domain plugin (W10)."""

from raptix_phishing.agent import DEFINITION, SUBAGENT_SPEC
from raptix_phishing.agent import create_phisher_agent as create_phisher_agent

from raptix.intelligence.agents.domain_composer import domain_baseline_tools
from raptix_core.plugin_loader import is_bundle_enabled

_ROLE = DEFINITION.role
_RECURSION_LIMIT = DEFINITION.recursion_limit
_SKILL_SOURCES = list(DEFINITION.skill_sources or ())
_STANDARD_TOOLS = domain_baseline_tools(DEFINITION)

__all__ = ["SUBAGENT_SPEC", "create_phisher_agent"]

if is_bundle_enabled("standard"):
    graph = create_phisher_agent()
    __all__.append("graph")
