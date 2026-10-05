"""Compatibility graph host for the contracts domain plugin (W10)."""

from raptix_contracts.agent import DEFINITION, SUBAGENT_SPEC
from raptix_contracts.agent import create_contract_auditor_agent as create_contract_auditor_agent

from raptix.intelligence.agents.domain_composer import domain_baseline_tools
from raptix_core.plugin_loader import is_bundle_enabled

_ROLE = DEFINITION.role
_RECURSION_LIMIT = DEFINITION.recursion_limit
_SKILL_SOURCES = list(DEFINITION.skill_sources or ())
_STANDARD_TOOLS = domain_baseline_tools(DEFINITION)

__all__ = ["SUBAGENT_SPEC", "create_contract_auditor_agent"]

if is_bundle_enabled("standard"):
    graph = create_contract_auditor_agent()
    __all__.append("graph")
