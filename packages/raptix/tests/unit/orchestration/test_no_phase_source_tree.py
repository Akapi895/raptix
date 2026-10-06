"""UKC phases must not appear as source-tree directories (ADR-0037, repo_invariant §36).

UKC macro-phases (initial_foothold, network_propagation,
action_on_objectives) are runtime state managed by
``orchestration/phases/``, not a physical source-tree layout. No
directory anywhere under the runtime package should be named after a
canonical phase — skills are organized by domain/capability and carry
``ukc_phases`` metadata instead.
"""

from __future__ import annotations

import os
from pathlib import Path

_RUNTIME_ROOT = Path(__file__).resolve().parents[3] / "raptix"

_CANONICAL_PHASES = frozenset(
    {
        "initial_foothold",
        "network_propagation",
        "action_on_objectives",
    }
)

_EXCLUDED = frozenset(
    {
        _RUNTIME_ROOT / "orchestration" / "phases",
    }
)


def test_no_phase_named_directories() -> None:
    """ADR-0037 — no directory outside orchestration/phases/ is named
    after a UKC macro-phase."""
    violations: list[Path] = []
    for dirpath, dirnames, _ in os.walk(_RUNTIME_ROOT):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        current = Path(dirpath)
        for dirname in dirnames:
            full = current / dirname
            if full in _EXCLUDED:
                continue
            if dirname in _CANONICAL_PHASES:
                violations.append(full.relative_to(_RUNTIME_ROOT))

    if violations:
        detail = "\n".join(f"  raptix/{v}" for v in violations)
        raise AssertionError(
            f"UKC phases are runtime state, not source-tree layout (ADR-0037).\n"
            f"Found {len(violations)} phase-named directory(ies):\n{detail}"
        )
