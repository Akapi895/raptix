"""Deprecated import path — ownership moved to ``raptix.orchestration.mission.opplan`` in W18.

This shim redirects ``sys.modules`` so that ``from raptix.middleware import opplan``
and attribute access on the module resolve to the canonical location.
"""

import importlib
import sys

_canonical = importlib.import_module("raptix.orchestration.mission.opplan")
sys.modules[__name__] = _canonical
