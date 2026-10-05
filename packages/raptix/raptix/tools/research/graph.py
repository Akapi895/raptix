"""Deprecated import path, kept as a compatibility shim.

Ownership moved to ``raptix.execution.tools.research.graph`` in W6,
which forwards to ``raptix_core.types.kg``. The PEP 562 dynamic
re-export of the moved module is preserved; retired in W11.
"""

from raptix.execution.tools.research.graph import *  # noqa: F401,F403
from raptix.execution.tools.research.graph import __dir__, __getattr__  # noqa: F401
