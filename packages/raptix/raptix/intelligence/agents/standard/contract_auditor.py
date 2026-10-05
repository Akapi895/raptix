"""Runtime graph host for the contracts domain plugin.

The contract auditor definition and factory live in
``raptix_contracts.agent`` (W10); this module only materializes the
LangGraph graph for the ``langgraph.json`` runtime entry.
"""

from raptix_contracts.agent import create_contract_auditor_agent

from raptix_core.plugin_loader import is_bundle_enabled

__all__ = []

if is_bundle_enabled("standard"):
    graph = create_contract_auditor_agent()
    __all__.append("graph")
