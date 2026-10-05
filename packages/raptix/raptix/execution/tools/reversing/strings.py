"""W10 compatibility exports for plugin-owned classified strings."""

from raptix_reversing import strings as _implementation
from raptix_reversing.strings import (
    MIN_STRING_LEN,
    ExtractedString,
    extract_strings,
    group_by_category,
)

__all__ = ["MIN_STRING_LEN", "ExtractedString", "extract_strings", "group_by_category"]
__getattr__ = _implementation.__getattribute__
