"""Compatibility exports for the scanner moved to the contracts plugin in W10."""

from raptix_contracts.patterns import ContractFinding, scan_solidity_source

__all__ = ["ContractFinding", "scan_solidity_source"]
