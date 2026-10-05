"""W10 compatibility exports for plugin-owned DCSync analysis."""

from raptix_active_directory import dcsync as _implementation
from raptix_active_directory.dcsync import dcsync_candidates

__all__ = ["dcsync_candidates"]
__getattr__ = _implementation.__getattribute__
