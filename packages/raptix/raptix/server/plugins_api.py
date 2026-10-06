"""Deprecated import path — ownership moved to ``raptix.interfaces.api.plugins_api`` in W15.

This shim re-exports every name (including private helpers used by tests)
and keeps ``sys.modules`` pointing at the canonical module so that
``patch.object(plugins_api, ...)`` in tests patches the real module.
"""

import importlib
import sys

_canonical = importlib.import_module("raptix.interfaces.api.plugins_api")
sys.modules[__name__] = _canonical
