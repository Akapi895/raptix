"""W10 compatibility exports for plugin-owned packer detection."""

from raptix_reversing import packer as _implementation
from raptix_reversing.packer import PackerVerdict, detect_packer, shannon_entropy

__all__ = ["PackerVerdict", "detect_packer", "shannon_entropy"]
__getattr__ = _implementation.__getattribute__
