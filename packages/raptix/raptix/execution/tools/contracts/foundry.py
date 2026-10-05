"""Compatibility exports for Foundry generators moved to the contracts plugin in W10."""

from raptix_contracts.foundry import (
    FoundryHarness,
    generate_access_control_test,
    generate_flashloan_test,
    generate_reentrancy_test,
)

__all__ = [
    "FoundryHarness",
    "generate_access_control_test",
    "generate_flashloan_test",
    "generate_reentrancy_test",
]
