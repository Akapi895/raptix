"""Composition dispatch and domain metadata without runtime imports."""

from types import SimpleNamespace

import pytest

from raptix_sdk import (
    DomainAgentDefinition,
    DomainCompositionError,
    DomainPack,
    create_domain_agent,
    domain_subagent,
    domains,
    installed_domain_packs,
)


@pytest.mark.parametrize("count", [0, 2])
def test_composition_requires_exactly_one_default_provider(monkeypatch, count: int) -> None:
    monkeypatch.setattr(domains, "entry_points", lambda **kwargs: [object()] * count)
    with pytest.raises(DomainCompositionError, match="expected one default"):
        create_domain_agent(DomainAgentDefinition("role", "specialist"))


def test_provider_failure_propagates_instead_of_creating_a_fallback_agent(monkeypatch) -> None:
    def unavailable(*args, **kwargs):
        raise DomainCompositionError("provider is unavailable")

    provider = SimpleNamespace(load=lambda: unavailable)
    monkeypatch.setattr(domains, "entry_points", lambda **kwargs: [provider])
    with pytest.raises(DomainCompositionError, match="provider is unavailable"):
        create_domain_agent(DomainAgentDefinition("role", "specialist"))


def test_subagent_declaration_does_not_require_a_composer(monkeypatch) -> None:
    monkeypatch.setattr(domains, "entry_points", lambda **kwargs: [])
    definition = DomainAgentDefinition("mobile_operator", "Mobile specialist", priority=55)
    spec = domain_subagent(definition)
    assert (spec.name, spec.description, spec.priority, spec.bundle) == (
        "mobile_operator",
        "Mobile specialist",
        55,
        "standard",
    )
    with pytest.raises(DomainCompositionError):
        spec.factory()


def test_domain_discovery_rejects_duplicate_ownership(monkeypatch) -> None:
    pack = DomainPack("mobile", "raptix_mobile", ("mobile_operator",))
    entry = SimpleNamespace(name="mobile", load=lambda: pack)
    monkeypatch.setattr(domains, "entry_points", lambda **kwargs: [entry, entry])
    with pytest.raises(DomainCompositionError, match="duplicate installed domain"):
        installed_domain_packs()


def test_domain_discovery_rejects_untyped_contributions(monkeypatch) -> None:
    entry = SimpleNamespace(name="mobile", load=lambda: {"name": "mobile"})
    monkeypatch.setattr(domains, "entry_points", lambda **kwargs: [entry])
    with pytest.raises(DomainCompositionError, match="invalid domain pack"):
        installed_domain_packs()
