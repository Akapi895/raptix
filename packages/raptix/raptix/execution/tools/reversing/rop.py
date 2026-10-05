"""W10 compatibility exports for plugin-owned gadget analysis."""

from raptix_reversing import rop as _implementation
from raptix_reversing.rop import RopGadget, filter_gadgets_by_pattern, find_rop_gadgets

__all__ = ["RopGadget", "filter_gadgets_by_pattern", "find_rop_gadgets"]
__getattr__ = _implementation.__getattribute__
