"""Deprecated import path, kept as a compatibility shim.

The engagement-graph implementation moved to `raptix.knowledge.graph`
in W4. Every submodule stays importable at its old path through a
deprecated re-export shim; it will be removed in W11 once callers
have migrated.
"""

from raptix.knowledge.graph import *  # noqa: F401,F403
