"""LangGraph graph factories: one immutable capability snapshot per execution."""

from __future__ import annotations

import asyncio
import importlib
from typing import Any
from urllib.parse import unquote

from langchain_core.runnables import RunnableConfig

from raptix.intelligence.agents.middleware_slots import (
    graph_toggles_context,
    knowledge_graph_context,
)
from raptix.intelligence.agents.specialist_catalog import (
    ORCHESTRATORS,
    skill_catalog,
    specialist_factories,
    tool_catalog,
)
from raptix.intelligence.agents.specialist_configuration import (
    Assembly,
    ConfigurationError,
    ConfigurationSnapshot,
    assemble_specialist,
    assembly_context,
)
from raptix.intelligence.agents.specialist_mcp import discover_mcp
from raptix_core.plugin_loader import load_subagents_for_parent


async def assemble_graph(role: str, config: RunnableConfig, **factory_kwargs: Any) -> Any:
    configurable = config.get("configurable", {})
    snapshot = ConfigurationSnapshot.model_validate(
        configurable.get("specialist_configuration", {})
    )
    graph_toggles = configurable.get("graph_toggles")
    knowledge_graph = configurable.get("knowledge_graph", {"enabled": True})
    if not isinstance(knowledge_graph, dict) or type(knowledge_graph.get("enabled")) is not bool:
        raise ConfigurationError("knowledge_graph.enabled must be a boolean")
    if graph_toggles is not None:
        if (
            not isinstance(graph_toggles, dict)
            or graph_toggles.keys() - {"auto_ingest_enabled", "tried_edges_enabled"}
            or any(type(value) is not bool for value in graph_toggles.values())
        ):
            raise ConfigurationError(
                "graph_toggles must contain only boolean auto-capture settings"
            )
        graph_toggles = dict(graph_toggles)
    factories = await asyncio.to_thread(specialist_factories)
    unknown = set(snapshot.specialists) - factories.keys()
    if unknown:
        raise ConfigurationError(f"Unknown or disabled specialists in snapshot: {sorted(unknown)}")
    relevant = {role}
    if role in ORCHESTRATORS:
        parent = "raptix" if role in {"decepticon", "raptix-delta"} else role
        specs = await asyncio.to_thread(load_subagents_for_parent, parent)
        relevant = {spec.name for spec in specs}
    selections = {
        key: selection for key, selection in snapshot.specialists.items() if key in relevant
    }
    selected_servers = {
        unquote(identity.split(":")[1])
        for s in selections.values()
        for identity in s.mcp
        if identity.startswith("mcp:") and len(identity.split(":")) == 3
    }
    _, mcp = await discover_mcp(selected_servers) if selected_servers else ([], {})
    assembly = Assembly(
        snapshot=snapshot, aliases={"soundwave": "autohunt"} if role == "autohunt" else {}
    )
    skills = await asyncio.to_thread(skill_catalog)
    for specialist, selection in selections.items():
        tools = await asyncio.to_thread(tool_catalog, specialist)
        selection.validate_ids(tools, skills, mcp)
        assembly.tools[specialist] = [tools[i] for i in selection.tools] + [
            mcp[i] for i in selection.mcp
        ]
        assembly.skills[specialist] = list(
            dict.fromkeys(i.rsplit("/", 1)[0] + "/" for i in selection.skills)
        )
    return await asyncio.to_thread(
        _build_graph,
        role,
        factories,
        assembly,
        factory_kwargs,
        graph_toggles,
        knowledge_graph["enabled"],
    )


def _build_graph(
    role: str,
    factories: dict[str, Any],
    assembly: Assembly,
    factory_kwargs: dict[str, Any],
    graph_toggles: dict[str, Any] | None = None,
    knowledge_graph_enabled: bool = True,
) -> Any:
    assembly_token = assembly_context.set(assembly)
    toggles_token = graph_toggles_context.set(graph_toggles)
    knowledge_token = knowledge_graph_context.set(knowledge_graph_enabled)
    try:
        if role in ORCHESTRATORS:
            module_name = "plugins.vulnresearch" if role == "vulnresearch" else "standard.raptix"
            module = importlib.import_module("raptix.intelligence.agents." + module_name)
            factory = getattr(
                module,
                "create_vulnresearch_agent" if role == "vulnresearch" else "create_raptix_agent",
            )
            if role == "raptix-delta":
                from raptix.intelligence.agents.standard.raptix_delta import DeltaDispatchState

                factory_kwargs.setdefault("state_schema", DeltaDispatchState)
        else:
            if role not in factories:
                raise ConfigurationError(f"Unknown specialist: {role}")
            factory = factories[role]
        graph = assemble_specialist(role, factory, **factory_kwargs)
        missing = assembly.tools.keys() - assembly.loaded.keys()
        if missing:
            raise ConfigurationError(f"Selected specialists were not assembled: {sorted(missing)}")
        return graph
    finally:
        knowledge_graph_context.reset(knowledge_token)
        graph_toggles_context.reset(toggles_token)
        assembly_context.reset(assembly_token)


def graph_factory(role: str) -> Any:
    async def configured(config: RunnableConfig) -> Any:
        return await assemble_graph(role, config)

    configured.__name__ = role.replace("-", "_")
    return configured


# Manifest attributes are factories, never module-level compiled graphs.
raptix = graph_factory("raptix")
raptix_delta = graph_factory("raptix-delta")
decepticon = graph_factory("decepticon")
recon = graph_factory("recon")
autohunt = graph_factory("autohunt")
soundwave = graph_factory("soundwave")
exploit = graph_factory("exploit")
appsec_specialist = graph_factory("appsec_specialist")
postexploit = graph_factory("postexploit")
analyst = graph_factory("analyst")
reverser = graph_factory("reverser")
contract_auditor = graph_factory("contract_auditor")
cloud_hunter = graph_factory("cloud_hunter")
ad_operator = graph_factory("ad_operator")
blue_cell = graph_factory("blue_cell")
phisher = graph_factory("phisher")
mobile_operator = graph_factory("mobile_operator")
wireless_operator = graph_factory("wireless_operator")
osint_operator = graph_factory("osint_operator")
iot_operator = graph_factory("iot_operator")
ics_operator = graph_factory("ics_operator")
forensicator = graph_factory("forensicator")
supply_chain_operator = graph_factory("supply_chain_operator")
vulnresearch = graph_factory("vulnresearch")
scanner = graph_factory("scanner")
detector = graph_factory("detector")
verifier = graph_factory("verifier")
patcher = graph_factory("patcher")
exploiter = graph_factory("exploiter")
