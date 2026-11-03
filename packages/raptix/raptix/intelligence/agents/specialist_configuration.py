"""Validated run snapshots and task-local additive factory inputs."""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from operator import or_
from typing import Annotated, Any, Callable, Literal

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ConfigurationError(ValueError):
    """A requested capability cannot be applied without changing the selection."""


class Additions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    skills: tuple[str, ...] = ()
    tools: tuple[str, ...] = ()
    mcp: tuple[str, ...] = ()

    @field_validator("skills", "tools", "mcp")
    @classmethod
    def unique_ids(cls, ids: tuple[str, ...]) -> tuple[str, ...]:
        if len(ids) > 200 or len(set(ids)) != len(ids) or any(not s or len(s) > 512 for s in ids):
            raise ValueError("Select at most 200 unique, non-empty capability IDs per kind")
        return tuple(sorted(ids))

    def validate_ids(self, tools: dict, skills: dict, mcp: dict) -> None:
        for kind, selected, catalog in (
            ("tool", self.tools, tools),
            ("skill", self.skills, skills),
            ("MCP tool", self.mcp, mcp),
        ):
            for identity in selected:
                if identity not in catalog:
                    raise ConfigurationError(f"Unknown or unavailable {kind}: {identity}")


class SpecialistSelection(Additions):
    global_revision: int = Field(default=0, ge=0)
    project_revision: int = Field(default=0, ge=0)


class ConfigurationSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: Literal[1] = 1
    revision: int = Field(default=0, ge=0)
    project_id: str | None = None
    specialists: dict[str, SpecialistSelection] = Field(default_factory=dict)


@dataclass
class Assembly:
    snapshot: ConfigurationSnapshot = field(default_factory=ConfigurationSnapshot)
    tools: dict[str, list[Any]] = field(default_factory=dict)
    skills: dict[str, list[str]] = field(default_factory=dict)
    builtins: dict[str, dict[str, Any]] = field(default_factory=dict)
    loaded: dict[str, dict[str, Any]] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)


assembly_context: ContextVar[Assembly | None] = ContextVar("specialist_assembly", default=None)


def assembly_role(role: str) -> str:
    assembly = assembly_context.get()
    return assembly.aliases.get(role, role) if assembly is not None else role


def assemble_specialist(role: str, factory: Callable[..., Any], **kwargs: Any) -> Any:
    graph = factory(**kwargs)
    assembly = assembly_context.get()
    if assembly is None:
        return graph
    role = assembly_role(role)
    if role in assembly.tools or role in assembly.skills:
        if role not in assembly.loaded:
            raise ConfigurationError(f"Specialist bypassed configured middleware assembly: {role}")
        node = graph.nodes.get("tools")
        loaded = getattr(getattr(node, "bound", None), "tools_by_name", {})
        missing = [t.name for t in assembly.tools.get(role, []) if t.name not in loaded]
        if missing:
            raise ConfigurationError(f"Specialist did not load selected tools: {missing}")
        assembly.loaded[role]["tools"] = sorted(loaded)
    return graph


def additional_tools(role: str, baseline: list[Any]) -> list[Any]:
    role = assembly_role(role)
    assembly = assembly_context.get()
    if assembly is None:
        return baseline
    names = {t.name for t in baseline}
    additions = []
    for candidate in assembly.tools.get(role, []):
        if candidate.name in names and (candidate.metadata or {}).get("mcp_server"):
            raise ConfigurationError(
                f"MCP tool name collides with a built-in tool: {candidate.name}"
            )
        if candidate.name not in names:
            additions.append(candidate)
            names.add(candidate.name)
    return [*baseline, *additions]


def additional_sources(role: str, sources: list[str]) -> list[str]:
    role = assembly_role(role)
    assembly = assembly_context.get()
    if assembly is None:
        return sources
    return list(dict.fromkeys([*sources, *assembly.skills.get(role, [])]))


class ConfigurationState(AgentState):
    specialist_configuration: Annotated[dict[str, Any], or_]


class ConfigurationEvidence(AgentMiddleware):
    state_schema = ConfigurationState

    def __init__(self, evidence: dict[str, Any]) -> None:
        self.evidence = evidence

    def before_agent(self, state: AgentState, runtime: Any) -> dict[str, Any]:
        return {"specialist_configuration": {self.evidence["specialist_id"]: self.evidence}}

    async def abefore_agent(self, state: AgentState, runtime: Any) -> dict[str, Any]:
        return self.before_agent(state, runtime)


def record_assembly(role: str, sources: list[str], middleware: list[Any]) -> list[Any]:
    role = assembly_role(role)
    assembly = assembly_context.get()
    if assembly is None:
        return middleware
    middleware_tools = [t.name for m in middleware for t in getattr(m, "tools", [])]
    baseline = assembly.builtins.setdefault(role, {})
    baseline["skills"] = sources
    baseline["middleware_tools"] = middleware_tools
    selection = assembly.snapshot.specialists.get(role, SpecialistSelection())
    evidence = {
        "revision": assembly.snapshot.revision,
        "project_id": assembly.snapshot.project_id,
        "specialist_id": role,
        "selection": selection.model_dump(mode="json"),
        "tools": sorted(
            set(
                baseline.get("tools", [])
                + middleware_tools
                + [t.name for t in assembly.tools.get(role, [])]
            )
        ),
        "skill_sources": additional_sources(role, sources),
        "status": "loaded",
    }
    if role in {"raptix", "decepticon", "vulnresearch"}:
        evidence["assembled_specialists"] = {
            key: value for key, value in assembly.loaded.items() if key != role
        }
    assembly.loaded[role] = evidence
    return [*middleware, ConfigurationEvidence(evidence)]
