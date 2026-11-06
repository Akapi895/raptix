"""Catalog actual assembled factories, packaged skills and registered tool objects."""

from __future__ import annotations

import importlib
from functools import lru_cache
from pathlib import Path
from typing import Any

from langchain_core.tools import BaseTool

from raptix.execution.backends import SKILLS_LOCAL_PATH
from raptix.execution.tools.plumbing.skills_registry import build_registry_from_package
from raptix.intelligence.agents.specialist_configuration import (
    Assembly,
    ConfigurationError,
    assembly_context,
)
from raptix_core.plugin_loader import load_plugin_tools, load_subagents_for_parent

ORCHESTRATORS = frozenset({"raptix", "decepticon", "raptix-delta", "vulnresearch"})


def specialist_factories() -> dict[str, Any]:
    factories = {
        s.name: s.factory
        for parent in ("raptix", "vulnresearch")
        for s in load_subagents_for_parent(parent)
    }
    for role in ("autohunt", "soundwave", "appsec_specialist"):
        module = importlib.import_module(f"raptix.intelligence.agents.standard.{role}")
        factories[role] = getattr(module, f"create_{role}_agent")
    return factories


def specialist_description(role: str) -> str:
    for parent in ("raptix", "vulnresearch"):
        for spec in load_subagents_for_parent(parent):
            if spec.name == role:
                return spec.description
    factory = specialist_factories()[role]
    module = importlib.import_module(factory.__module__)
    return (module.__doc__ or "").strip().split("\n")[0]


def skill_catalog() -> dict[str, Any]:
    return {
        s.id: s
        for s in build_registry_from_package(Path(SKILLS_LOCAL_PATH))
        if s.id.endswith("/SKILL.md")
    }


def tool_catalog(role: str) -> dict[str, BaseTool]:
    from raptix.execution import tools as registered
    from raptix.execution.tools.web.search import web_fetch, web_search

    candidates = [
        t for key in registered.__all__ if key.endswith("_TOOLS") for t in getattr(registered, key)
    ]
    candidates.extend(load_plugin_tools(role=role))
    candidates.extend([web_search, web_fetch])
    catalog = {}
    for candidate in candidates:
        if not isinstance(candidate, BaseTool):
            continue
        identity = "tool:" + candidate.name
        if identity in catalog and catalog[identity] is not candidate:
            raise ConfigurationError(f"Ambiguous integrated tool identity: {identity}")
        catalog[identity] = candidate
    return catalog


@lru_cache(maxsize=128)
def builtin_inventory(role: str) -> dict[str, Any]:
    factories = specialist_factories()
    if role not in factories:
        raise ConfigurationError(f"Unknown or disabled specialist: {role}")
    assembly = Assembly(aliases={"soundwave": "autohunt"} if role == "autohunt" else {})
    token = assembly_context.set(assembly)
    try:
        factories[role]()
    finally:
        assembly_context.reset(token)
    if role not in assembly.builtins:
        raise ConfigurationError(f"Specialist does not use the shared assembler: {role}")
    inventory = assembly.builtins[role]
    return {
        "tools": sorted(set(inventory.get("tools", []) + inventory.get("middleware_tools", []))),
        "skills": sorted(
            s.id
            for s in skill_catalog().values()
            if any(s.id.startswith(p) for p in inventory["skills"])
        ),
        "skill_sources": inventory["skills"],
        "behavior": specialist_description(role),
    }


def capability_metadata(
    identity: str, name: str, description: str, source: str, **extra: Any
) -> dict[str, Any]:
    return {
        "id": identity,
        "name": name,
        "description": description,
        "source": source,
        "installed": True,
        "available": True,
        "status": "available",
        "requirements": [],
        **extra,
    }
