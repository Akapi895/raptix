"""Declarative domain-agent and package-backed prompt contracts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath


class DomainCompositionError(RuntimeError):
    """A domain cannot be composed through its installed runtime provider."""


@dataclass(frozen=True)
class DomainPack:
    """Installed ownership metadata for a domain's public package."""

    name: str
    package: str
    roles: tuple[str, ...] = ()


@dataclass(frozen=True)
class DomainAgentDefinition:
    role: str
    description: str
    tool_names: tuple[str, ...] = ()
    skill_sources: tuple[str, ...] | None = None
    recursion_limit: int = 250
    priority: int = 100
    parent_agents: tuple[str, ...] = ("raptix", "decepticon")
    bundle: str = "standard"

    def __post_init__(self) -> None:
        if not self.role or not self.description or self.recursion_limit < 1:
            raise ValueError(
                "domain agent requires a role, description and positive recursion limit"
            )


@dataclass(frozen=True)
class PromptResource:
    """A role identity or workflow fragment inside an installed package."""

    name: str
    package: str
    path: str
    workflow: bool = False

    def __post_init__(self) -> None:
        path = PurePosixPath(self.path)
        if not self.name or not self.package or not self.path:
            raise ValueError("prompt resource requires a name, package and path")
        if path.is_absolute() or ".." in path.parts or "\\" in self.path or ":" in self.path:
            raise ValueError("prompt resource path must stay within its package")
