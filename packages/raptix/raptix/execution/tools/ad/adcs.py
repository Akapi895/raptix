"""W10 compatibility exports for plugin-owned ADCS analysis."""

from raptix_active_directory import adcs as _implementation
from raptix_active_directory.adcs import ADCSFinding, analyze_adcs_templates

__all__ = ["ADCSFinding", "analyze_adcs_templates"]
__getattr__ = _implementation.__getattribute__
