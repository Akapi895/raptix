"""Framework-independent contract tools registered through the public SDK."""

from __future__ import annotations

import json

from raptix_contracts.foundry import (
    generate_access_control_test,
    generate_flashloan_test,
    generate_reentrancy_test,
)
from raptix_contracts.patterns import scan_solidity_source
from raptix_sdk import PluginBundle


def solidity_scan(source: str) -> str:
    """Run offline Solidity pattern scanner.

    Returns findings for: reentrancy, tx.origin, delegatecall, bad randomness,
    unchecked ecrecover, proxy init, missing access control, unchecked casts,
    flash-loan callbacks, oracle abuse.

    Args:
        source: Raw Solidity source code to scan.
    """
    return json.dumps(
        [finding.to_dict() for finding in scan_solidity_source(source)],
        indent=2,
        default=str,
        ensure_ascii=False,
    )


def foundry_reentrancy_test(target: str, function: str, target_path: str = "src/Target.sol") -> str:
    """Generate a Foundry reentrancy PoC test for target.function."""
    harness = generate_reentrancy_test(target, function, target_path)
    return json.dumps(
        {"path": harness.path, "source": harness.source}, indent=2, ensure_ascii=False
    )


def foundry_access_test(target: str, function: str, target_path: str = "src/Target.sol") -> str:
    """Generate a Foundry access-control bypass test for target.function."""
    harness = generate_access_control_test(target, function, target_path)
    return json.dumps(
        {"path": harness.path, "source": harness.source}, indent=2, ensure_ascii=False
    )


def foundry_flashloan_test(target: str, target_path: str = "src/Target.sol") -> str:
    """Generate a Foundry flash-loan callback auth test for target."""
    harness = generate_flashloan_test(target, target_path)
    return json.dumps(
        {"path": harness.path, "source": harness.source}, indent=2, ensure_ascii=False
    )


def get_bundle() -> PluginBundle:
    """Expose opt-in tool overrides scoped to the contract auditor."""
    return PluginBundle(
        bundle="contracts",
        roles=("contract_auditor",),
        replaced_tools={
            "solidity_scan": solidity_scan,
            "foundry_reentrancy_test": foundry_reentrancy_test,
            "foundry_access_test": foundry_access_test,
            "foundry_flashloan_test": foundry_flashloan_test,
        },
    )
