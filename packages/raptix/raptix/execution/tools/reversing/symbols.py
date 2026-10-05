"""W10 compatibility exports for plugin-owned symbol analysis."""

from raptix_reversing import symbols as _implementation
from raptix_reversing.symbols import SymbolReport, summarize_symbols

__all__ = ["SymbolReport", "summarize_symbols"]
__getattr__ = _implementation.__getattribute__
