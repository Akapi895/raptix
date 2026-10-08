"""Framework assembly for SDK-declared domain specialists."""

from __future__ import annotations

from typing import Any

from langchain.agents import create_agent

from raptix.execution.backends import build_sandbox_backend, make_agent_backend
from raptix.execution.tools import (
    AD_TOOLS,
    BASH_TOOLS,
    CLOUD_TOOLS,
    CONTRACT_TOOLS,
    REFERENCES_TOOLS,
    RESEARCH_TOOLS,
    REVERSING_TOOLS,
    WEB_TOOLS,
)
from raptix.execution.tools.bash.bash import set_sandbox
from raptix.intelligence.agents._benchmark_mode import benchmark_skill_sources
from raptix.intelligence.agents.build import build_middleware, build_tools
from raptix.intelligence.llm import LLMFactory
from raptix.intelligence.prompts import load_prompt
from raptix_core.contracts.domains import DomainAgentDefinition, DomainCompositionError
from raptix_core.plugin_loader import load_plugin_callbacks

_TOOL_GROUPS = {
    "bash": BASH_TOOLS,
    "active-directory": AD_TOOLS,
    "cloud": CLOUD_TOOLS,
    "contracts": CONTRACT_TOOLS,
    "reversing": REVERSING_TOOLS,
    "web": WEB_TOOLS,
}


def _tool_name(tool: Any) -> str:
    """LangChain tools carry ``.name``; Wave T3 turned the ``kg_ingest_*``
    parser services into plain functions, which only have ``__name__``."""
    name = getattr(tool, "name", None)
    if isinstance(name, str) and name:
        return name
    return tool.__name__


_NAMED_TOOLS = {
    _tool_name(tool): tool
    for tool in [
        *REFERENCES_TOOLS,
        *RESEARCH_TOOLS,
        *(tool for group in _TOOL_GROUPS.values() for tool in group),
    ]
}


def domain_baseline_tools(definition: DomainAgentDefinition) -> dict[str, Any]:
    """Resolve declared capabilities to the existing framework adapters."""
    try:
        selected = [_NAMED_TOOLS[name] for name in definition.tool_names]
    except KeyError as exc:
        raise DomainCompositionError(
            f"unknown tool capability for {definition.role}: {exc}"
        ) from exc
    return {_tool_name(tool): tool for tool in selected}


def compose_domain_agent(
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
) -> Any:
    """Reuse the standard agent builders with the domain's declared defaults."""
    role = definition.role
    if llm is None or fallback_models is None:
        factory = LLMFactory()
        if llm is None:
            llm = factory.get_model(role)
        if fallback_models is None:
            fallback_models = factory.get_fallback_models(role)
    if sandbox is None:
        sandbox = build_sandbox_backend()
    set_sandbox(sandbox)
    if backend is None:
        backend = make_agent_backend(sandbox)
    if tools is None:
        tools = build_tools(role=role, standard_tools=domain_baseline_tools(definition))
    if middleware is None:
        skill_options = {}
        if definition.skill_sources is not None:
            skill_options["skill_sources"] = [*definition.skill_sources, *benchmark_skill_sources()]
        middleware = build_middleware(
            role=role,
            backend=backend,
            llm=llm,
            fallback_models=fallback_models,
            sandbox=sandbox,
            **skill_options,
        )
    if system_prompt is None:
        system_prompt = load_prompt(role, shared=["bash"])
    return create_agent(
        llm, system_prompt=system_prompt, tools=tools, middleware=middleware, name=role
    ).with_config(
        {
            "recursion_limit": recursion_limit or definition.recursion_limit,
            "callbacks": load_plugin_callbacks(role=role, backend=backend),
        }
    )
