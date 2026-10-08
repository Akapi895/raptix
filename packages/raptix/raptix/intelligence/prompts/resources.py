"""Resolve installed domain prompt fragments before shared policy assembly."""

from __future__ import annotations

from importlib.metadata import entry_points
from importlib.resources import files

from raptix_core.contracts.domains import DomainCompositionError, PromptResource


def read_domain_prompt(name: str, *, workflow: bool = False) -> str | None:
    matches: list[PromptResource] = []
    for entry in entry_points(group="raptix.prompt_resources"):
        for resource in entry.load():
            if not isinstance(resource, PromptResource):
                raise DomainCompositionError(f"invalid prompt resource from {entry.name}")
            if resource.name == name and resource.workflow == workflow:
                matches.append(resource)
    if len(matches) > 1:
        raise DomainCompositionError(
            f"duplicate domain prompt resource: {name} (workflow={workflow})"
        )
    if not matches:
        return None
    resource = matches[0]
    return files(resource.package).joinpath(resource.path).read_text(encoding="utf-8")
