"""W10 compatibility exports for plugin-owned shadow-credential analysis."""

from raptix_active_directory import shadow_creds as _implementation
from raptix_active_directory.shadow_creds import ShadowCredsFinding, analyze_shadow_credentials

__all__ = ["ShadowCredsFinding", "analyze_shadow_credentials"]
__getattr__ = _implementation.__getattribute__
