"""Compose domain agents through the public runtime-provider entry-point."""

from __future__ import annotations

from functools import partial
from importlib.metadata import entry_points
from typing import Any

from raptix_core.contracts.domains import DomainAgentDefinition, DomainCompositionError, DomainPack
from raptix_core.plugin_loader import SubAgentSpec
from raptix_core.protocols.agent import AgentProtocol


def create_domain_agent(
    definition: DomainAgentDefinition,
    *,
    backend: Any = None,
    llm: Any = None,
    fallback_models: list | None = None,
    sandbox: Any = None,
    tools: list[Any] | None = None,
    middleware: list[Any] | None = None,
    system_prompt: str | None = None,
    recursion_limit: int | None = None,
) -> AgentProtocol:
    """Keep framework construction behind the installed default composer."""
    providers = tuple(entry_points(group="raptix.agent_composers", name="default"))
    if len(providers) != 1:
        raise DomainCompositionError(
            f"expected one default domain composer, found {len(providers)}; install raptix"
        )
    composer = providers[0].load()
    return composer(
        definition,
        backend=backend,
        llm=llm,
        fallback_models=fallback_models,
        sandbox=sandbox,
        tools=tools,
        middleware=middleware,
        system_prompt=system_prompt,
        recursion_limit=recursion_limit,
    )


def domain_subagent(definition: DomainAgentDefinition) -> SubAgentSpec:
    """Register a domain without loading runtime construction machinery."""
    return SubAgentSpec(
        name=definition.role,
        description=definition.description,
        factory=partial(create_domain_agent, definition),
        parent_agents=definition.parent_agents,
        bundle=definition.bundle,
        priority=definition.priority,
    )


def installed_domain_packs() -> tuple[DomainPack, ...]:
    """Discover domain ownership without loading any agent runtime."""
    packs: dict[str, DomainPack] = {}
    for entry in entry_points(group="raptix.domains"):
        pack = entry.load()
        if not isinstance(pack, DomainPack) or pack.name != entry.name:
            raise DomainCompositionError(f"invalid domain pack from {entry.name}")
        if pack.name in packs:
            raise DomainCompositionError(f"duplicate installed domain pack: {pack.name}")
        packs[pack.name] = pack
    return tuple(packs[name] for name in sorted(packs))
