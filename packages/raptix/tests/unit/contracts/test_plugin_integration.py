"""Installed contracts bundle through runtime tool assembly and legacy adapters."""

import pytest
from langchain_core.tools import BaseTool, StructuredTool, tool
from raptix_contracts import foundry as plugin_foundry
from raptix_contracts import patterns as plugin_patterns
from raptix_contracts.tools import get_bundle

from raptix.execution.tools.contracts import foundry, patterns
from raptix.execution.tools.contracts.tools import CONTRACT_TOOLS
from raptix.intelligence.agents.build import build_tools


def test_legacy_exports_share_plugin_implementation_identity() -> None:
    assert patterns.ContractFinding is plugin_patterns.ContractFinding
    assert patterns.scan_solidity_source is plugin_patterns.scan_solidity_source
    assert foundry.FoundryHarness is plugin_foundry.FoundryHarness
    assert foundry.generate_reentrancy_test is plugin_foundry.generate_reentrancy_test


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("solidity_scan", {"source": "tx.origin"}),
        ("foundry_reentrancy_test", {"target": "Vault", "function": "withdraw"}),
        ("foundry_access_test", {"target": "Vault", "function": "withdraw"}),
        ("foundry_flashloan_test", {"target": "Vault"}),
    ],
)
def test_discovered_tool_preserves_adapter_schema_and_output(monkeypatch, name, arguments) -> None:
    monkeypatch.setenv("RAPTIX_PLUGINS", "standard,contracts")
    assembled = build_tools(role="contract_auditor", standard_tools=CONTRACT_TOOLS)
    converted = [
        candidate if isinstance(candidate, BaseTool) else tool(candidate) for candidate in assembled
    ]
    selected = next(candidate for candidate in converted if candidate.name == name)
    adapter = next(candidate for candidate in CONTRACT_TOOLS if candidate.name == name)
    assert isinstance(selected, StructuredTool)
    assert selected.func is get_bundle().replaced_tools[name]
    assert selected.args == adapter.args
    assert selected.invoke(arguments) == adapter.invoke(arguments)
    assert len(converted) == len(CONTRACT_TOOLS)


def test_plugin_does_not_add_tools_to_other_roles(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_PLUGINS", "standard,contracts")
    assert build_tools(role="recon", standard_tools=[]) == []


def test_default_standard_bundle_retains_runtime_adapters(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_PLUGINS", "standard")
    assert build_tools(role="contract_auditor", standard_tools=CONTRACT_TOOLS) == CONTRACT_TOOLS


def test_explicit_override_wins_over_contracts_plugin(monkeypatch) -> None:
    monkeypatch.setenv("RAPTIX_PLUGINS", "standard,contracts")
    replacement = next(
        candidate for candidate in CONTRACT_TOOLS if candidate.name == "solidity_scan"
    )
    assembled = build_tools(
        role="contract_auditor",
        standard_tools=CONTRACT_TOOLS,
        overrides={"solidity_scan": replacement},
    )
    assert replacement in assembled
