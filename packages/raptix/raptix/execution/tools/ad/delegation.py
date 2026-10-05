"""W10 compatibility exports for plugin-owned delegation analysis."""

from raptix_active_directory import delegation as _implementation
from raptix_active_directory.delegation import DelegationFinding, analyze_delegation

__all__ = ["DelegationFinding", "analyze_delegation"]
__getattr__ = _implementation.__getattribute__
