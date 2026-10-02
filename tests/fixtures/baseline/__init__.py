"""Loader for baseline fixtures (ADR-0027, Step 0).

Three fixture categories, as specified in ARCHITECTURE_AUDIT_FIX.md:

- ``failed_task_dispatch.json`` — for Step 1 (typed failure/terminal)
- ``kg_freshness.json`` — for Step 2 (KG freshness refresh)
- ``recon_exploit_handoff.json`` — for Step 3 (IF contract) and
  Step 4 (verified foothold gate)

Usage::

    from tests.fixtures.baseline import (
        load_failed_task_dispatch,
        load_kg_freshness,
        load_recon_exploit_handoff,
    )

    dispatch = load_failed_task_dispatch()
    kg = load_kg_freshness()
    handoff = load_recon_exploit_handoff()
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES_DIR = Path(__file__).resolve().parent

_FAILED_TASK = FIXTURES_DIR / "failed_task_dispatch.json"
_KG_FRESHNESS = FIXTURES_DIR / "kg_freshness.json"
_RECON_EXPLOIT = FIXTURES_DIR / "recon_exploit_handoff.json"


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_failed_task_dispatch() -> dict[str, Any]:
    """Recorded failed task() dispatch fixture for Step 1."""
    return _load(_FAILED_TASK)


def load_kg_freshness() -> dict[str, Any]:
    """Synthetic KG fixture for Step 2 freshness experiments."""
    return _load(_KG_FRESHNESS)


def load_recon_exploit_handoff() -> dict[str, Any]:
    """Recon→exploit handoff + foothold states A–E for Steps 3 and 4."""
    return _load(_RECON_EXPLOIT)


def fixture_schema_version(fixture: dict[str, Any]) -> int:
    """Return the schema_version of a loaded fixture."""
    return int(fixture["schema_version"])
