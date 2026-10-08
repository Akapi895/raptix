"""Contracts domain behavior and its public dependency boundary."""

import ast
import subprocess
import sys
from importlib.metadata import entry_points
from pathlib import Path

from raptix_contracts.tools import solidity_scan


def test_installed_bundle_exposes_only_contract_auditor_tools() -> None:
    entry = next(ep for ep in entry_points(group="raptix.bundles") if ep.name == "contracts")
    bundle = entry.load()()
    assert bundle.roles == ("contract_auditor",)
    assert bundle.bundle == "contracts"
    assert set(bundle.replaced_tools) == {
        "solidity_scan",
        "foundry_reentrancy_test",
        "foundry_access_test",
        "foundry_flashloan_test",
    }


def test_scanner_negative_control_returns_empty_findings() -> None:
    assert solidity_scan("pragma solidity ^0.8.20;") == "[]"


def test_plugin_imports_without_loading_framework() -> None:
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from raptix_contracts.tools import get_bundle; "
            "assert get_bundle().roles == ('contract_auditor',); "
            "assert not any(n == 'raptix' or n.startswith('raptix.') for n in sys.modules); "
            "assert not any(n.startswith(('langchain', 'langgraph', 'deepagents')) "
            "for n in sys.modules)",
        ],
        check=True,
    )


def test_plugin_source_imports_only_stdlib_sdk_and_core() -> None:
    package = Path(__file__).resolve().parents[1] / "raptix_contracts"
    allowed = sys.stdlib_module_names | {"raptix_sdk", "raptix_core", "raptix_contracts"}
    for source in package.rglob("*.py"):
        for node in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                assert all(alias.name.split(".")[0] in allowed for alias in node.names), source
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                assert node.module.split(".")[0] in allowed, source
