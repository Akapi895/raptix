"""W10 compatibility exports for plugin-owned binary identification."""

from raptix_reversing import binary as _implementation
from raptix_reversing.binary import BinaryInfo, identify_binary

__all__ = ["BinaryInfo", "identify_binary"]
__getattr__ = _implementation.__getattribute__
