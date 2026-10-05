"""Domain composition retains tools, prompts and injected-dependency semantics."""

import hashlib
from importlib import import_module
from importlib.metadata import entry_points
from types import SimpleNamespace

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage

from raptix.intelligence.agents.domain_composer import domain_baseline_tools
from raptix.intelligence.prompts import load_prompt
from raptix.intelligence.prompts.builder import _read_fragment, _read_workflow_for_role
from raptix_sdk import DomainAgentDefinition, DomainCompositionError, create_domain_agent

_SNAPSHOTS = [
    (
        "contracts",
        "contract_auditor",
        50,
        1000,
        "2fc85885c2de77b1e487adb7289e049ee0d3ee5aeaa2323e7b2166f3edb33841",
    ),
    (
        "reversing",
        "reverser",
        40,
        1000,
        "691265a1089deea55bce559d3fabec982d6193da0b5e9eeac7932ca4c56d3d8a",
    ),
    (
        "mobile",
        "mobile_operator",
        55,
        250,
        "0d4d6faab964e5170bc97b4f6edfe43025d5ebe911be4aa8a73d9b2d4f47e1a5",
    ),
    (
        "iot",
        "iot_operator",
        58,
        250,
        "6108b85f8ca5884fe837a362237af221bff6bec194ed9c8daaf42b19ecda69ca",
    ),
    (
        "ics",
        "ics_operator",
        92,
        250,
        "eb326dc46e40929d8af54322ba41a6fd7a29248ee410b653224316a05dd1c4be",
    ),
    (
        "wireless",
        "wireless_operator",
        85,
        200,
        "da6ed431034098e235812879663053dd2c9130ffa79cb722453b8aa4f5ad437b",
    ),
    (
        "cloud",
        "cloud_hunter",
        60,
        1000,
        "206cbdad0568b2d6b989382e40763b9a95945e73797c0f773f6920d1ce3e279d",
    ),
    (
        "phishing",
        "phisher",
        15,
        250,
        "957fdb05b761789ab1ea0e5e74b7930242d8885d0dd8a08161a4c7db273cdfdd",
    ),
    (
        "active_directory",
        "ad_operator",
        70,
        1000,
        "e3163b6b7be8e91eba049d0e592b9f3a611dc7b3a5421cd19e641134231d1835",
    ),
]


@pytest.mark.parametrize(("pack", "role", "priority", "limit", "prompt_hash"), _SNAPSHOTS)
def test_domain_keeps_role_metadata_and_identity_fragment(
    pack, role, priority, limit, prompt_hash
) -> None:
    plugin = import_module(f"raptix_{pack}.agent")
    assert (
        plugin.DEFINITION.role,
        plugin.DEFINITION.priority,
        plugin.DEFINITION.recursion_limit,
    ) == (role, priority, limit)
    assert hashlib.sha256(_read_fragment(role).encode()).hexdigest() == prompt_hash
    assert list(domain_baseline_tools(plugin.DEFINITION)) == list(plugin.DEFINITION.tool_names)
    assert (
        import_module(f"raptix.intelligence.agents.standard.{role}").SUBAGENT_SPEC
        is plugin.SUBAGENT_SPEC
    )


@pytest.mark.parametrize(("pack", "role", "priority", "limit", "prompt_hash"), _SNAPSHOTS)
def test_sdk_factory_builds_and_runs_real_graph_with_injected_dependencies(
    pack, role, priority, limit, prompt_hash
) -> None:
    definition = import_module(f"raptix_{pack}.agent").DEFINITION
    model = FakeMessagesListChatModel(responses=[AIMessage(content="domain-composed")])
    graph = create_domain_agent(
        definition,
        llm=model,
        fallback_models=[],
        sandbox=SimpleNamespace(),
        backend=SimpleNamespace(),
        tools=[],
        middleware=[],
        system_prompt="test identity",
        recursion_limit=7,
    )
    assert graph.name == role
    assert graph.config["recursion_limit"] == 7
    assert (
        graph.invoke({"messages": [("human", "test")]})["messages"][-1].content == "domain-composed"
    )


def test_unknown_baseline_capability_is_an_explicit_error() -> None:
    definition = DomainAgentDefinition("reverser", "specialist", tool_names=("missing-capability",))
    with pytest.raises(DomainCompositionError, match="unknown tool capability"):
        domain_baseline_tools(definition)


def test_domain_subagent_registration_has_no_duplicate_roles() -> None:
    names = [entry.name for entry in entry_points(group="raptix.subagents")]
    assert len(names) == len(set(names))


@pytest.mark.parametrize("role", ["contract_auditor", "reverser", "cloud_hunter", "ad_operator"])
def test_domain_prompt_still_receives_shared_policy_assembly(role: str) -> None:
    prompt = load_prompt(role, shared=["bash"])
    assert _read_fragment(role) in prompt
    assert "<FAITHFUL_REPORTING>" in prompt
    assert "<VERIFICATION_GATE>" in prompt
    assert "<OUTPUT_DISCIPLINE>" in prompt
    workflow = _read_workflow_for_role(role)
    if workflow is not None:
        assert workflow in prompt


@pytest.mark.parametrize(
    ("role", "expected_hash"),
    [
        ("mobile_operator", "7e8f1236d2cabb81e4fc60d92dd953675d9dc0f201196c9ad5178b08ef3f1c84"),
        ("wireless_operator", "772acd0901eb4a632ced0de4d19ad0a164e818a5c02227a52299adacf43a058c"),
        ("phisher", "6a3e934c785b0450d65f54bc9275e812d78f9de320022c7444a0286bf3211ff4"),
    ],
)
def test_domain_workflow_is_preserved_inside_the_assembled_prompt(role, expected_hash) -> None:
    workflow = _read_workflow_for_role(role)
    assert workflow is not None
    assert hashlib.sha256(workflow.encode()).hexdigest() == expected_hash
    assert workflow in load_prompt(role, shared=["bash"])
