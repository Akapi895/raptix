"""Deprecated import path, kept as a compatibility shim.

Ownership moved to ``raptix.intelligence.llm.models`` in W5, which
forwards to ``raptix_core.types.llm``. The PEP 562 dynamic re-export
of the moved module is preserved; retired in W11.
"""

from raptix.intelligence.llm.models import *  # noqa: F401,F403
from raptix.intelligence.llm.models import __dir__, __getattr__  # noqa: F401
