"""Deprecated import path — ownership moved to ``raptix.orchestration.mission.engagement`` in W17.

This shim redirects ``sys.modules`` so that string-based
``monkeypatch.setattr("raptix.middleware.engagement.…")`` patches land
on the canonical module.
"""

import importlib
import sys

_canonical = importlib.import_module("raptix.orchestration.mission.engagement")
sys.modules[__name__] = _canonical
