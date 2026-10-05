"""Frozen definitions and prompt resource confinement for domain packs."""

from dataclasses import FrozenInstanceError

import pytest

from raptix_core.contracts.domains import DomainAgentDefinition, PromptResource


def test_domain_definition_is_immutable() -> None:
    definition = DomainAgentDefinition("mobile_operator", "Mobile specialist")
    with pytest.raises(FrozenInstanceError):
        setattr(definition, "role", "other")


@pytest.mark.parametrize(
    ("role", "description", "limit"),
    [("", "specialist", 250), ("role", "", 250), ("role", "specialist", 0)],
)
def test_domain_definition_rejects_missing_identity_or_invalid_limit(
    role, description, limit
) -> None:
    with pytest.raises(ValueError):
        DomainAgentDefinition(role, description, recursion_limit=limit)


@pytest.mark.parametrize(
    "path",
    [
        "/etc/passwd",
        "../policy.md",
        "prompts/../../policy.md",
        "C:/policy.md",
        "prompts\\policy.md",
    ],
)
def test_prompt_resource_rejects_paths_outside_its_package(path: str) -> None:
    with pytest.raises(ValueError, match="within its package"):
        PromptResource("role", "domain_package", path)
