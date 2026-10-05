"""W10 compatibility exports for plugin-owned GPO analysis."""

from raptix_active_directory import gpo as _implementation
from raptix_active_directory.gpo import GPOFinding, analyze_gpo_abuse

__all__ = ["GPOFinding", "analyze_gpo_abuse"]
__getattr__ = _implementation.__getattribute__
