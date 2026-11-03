"""Authenticated catalog and preflight for additive specialist configuration."""

import asyncio
from time import monotonic
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from raptix.intelligence.agents.specialist_catalog import (
    builtin_inventory,
    capability_metadata,
    skill_catalog,
    specialist_description,
    specialist_factories,
    tool_catalog,
)
from raptix.intelligence.agents.specialist_configuration import Additions, ConfigurationError
from raptix.intelligence.agents.specialist_mcp import discover_mcp

router = APIRouter(prefix="/_raptix/specialists", tags=["Specialist configuration"])
_SKILL_METADATA_TTL = 30  # Packaged metadata only; validation and execution read live definitions.
_skill_metadata: tuple[float, asyncio.Task[dict[str, Any]]] | None = None


async def _catalog_skills() -> dict[str, Any]:
    global _skill_metadata
    if _skill_metadata is not None:
        expires, task = _skill_metadata
        if expires > monotonic() and not (
            task.done() and (task.cancelled() or task.exception() is not None)
        ):
            return await asyncio.shield(task)
    task = asyncio.create_task(asyncio.to_thread(skill_catalog))
    _skill_metadata = (monotonic() + _SKILL_METADATA_TTL, task)
    return await asyncio.shield(task)


@router.get("")
async def specialists() -> dict[str, Any]:
    factories = await asyncio.to_thread(specialist_factories)
    descriptions = await asyncio.to_thread(
        lambda: {role: specialist_description(role) for role in factories}
    )
    return {
        "specialists": [
            {
                "id": role,
                "name": role.replace("_", " ").title(),
                "description": descriptions[role],
                "available": True,
                "status": "registered",
                "source": factory.__module__,
            }
            for role, factory in sorted(factories.items())
        ]
    }


@router.get("/catalog")
async def catalog(specialist_id: str = Query(min_length=1, max_length=128)) -> dict[str, Any]:
    try:
        builtins, tools, (servers, _), skills = await asyncio.gather(
            asyncio.to_thread(builtin_inventory, specialist_id),
            asyncio.to_thread(tool_catalog, specialist_id),
            discover_mcp(),
            _catalog_skills(),
        )
    except ConfigurationError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "specialist_id": specialist_id,
        "builtins": builtins,
        "tools": [
            capability_metadata(
                identity,
                tool.name,
                tool.description,
                getattr(tool.func, "__module__", "runtime") if hasattr(tool, "func") else "runtime",
                execution_readiness="invocation_checked",
            )
            for identity, tool in sorted(tools.items())
        ],
        "skills": [
            capability_metadata(
                s.id,
                s.name,
                s.description,
                s.source,
                requirements=list(s.requires),
                execution_readiness="knowledge_only",
            )
            for s in skills.values()
        ],
        "servers": servers,
    }


class ValidateSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    specialist_id: str
    additions: Additions


@router.post("/validate")
async def validate(selection: ValidateSelection) -> dict[str, Any]:
    try:
        if selection.specialist_id not in await asyncio.to_thread(specialist_factories):
            raise ConfigurationError("Unknown or disabled specialist")
        _, mcp = await discover_mcp() if selection.additions.mcp else ([], {})
        tools = await asyncio.to_thread(tool_catalog, selection.specialist_id)
        skills = await asyncio.to_thread(skill_catalog)
        selection.additions.validate_ids(tools, skills, mcp)
    except ConfigurationError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"valid": True, "status": "ready_for_assembly", "authorization": "checked_at_invocation"}
