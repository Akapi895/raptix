"""T11 metrics — pure functions over names, no I/O, no LLM, no logging.

Every metric takes plain tool-name collections (never raw parameter
values — the T0 telemetry redaction rule applies to the whole wave).
Formulas are documented on each function and mirrored verbatim in the
plan's T11 metric table:

* ``selection_precision``      — correct capability / all selected
* ``invalid_selection_rate``   — forbidden / all selected
* ``unnecessary_tool_calls``   — calls producing no value (outside
  required ∪ optional)
* ``bash_fallback_rate``       — bash calls / all calls (macro proxy:
  a call to the ``bash`` tool where a typed capability could have been
  selected)
* ``task_success``             — all required selected AND no forbidden
  selected
* ``capability_exposure_recall`` — required exposed / all required
* ``forbidden_exposure_rate``  — forbidden exposed / all forbidden
  (exposure-side analog of invalid_selection_rate; needs no LLM)
* ``discovery_latency``        — 0-based position of the first required
  tool in the surface order (``None`` when never exposed)

Selection-dependent metrics return ``None`` (not 0) when their
denominator is empty, so "nothing selected" is never confused with
"perfect selection".
"""

from __future__ import annotations

from collections.abc import Iterable

BASH_TOOL_NAME = "bash"


def _as_set(names: Iterable[str]) -> set[str]:
    return set(names)


def selection_precision(
    selected: Iterable[str], required: Iterable[str], optional: Iterable[str]
) -> float | None:
    """Valuable selections / all selections (duplicates count); ``None`` if nothing selected."""
    sequence = list(selected)
    if not sequence:
        return None
    valuable = _as_set(required) | _as_set(optional)
    return sum(1 for call in sequence if call in valuable) / len(sequence)


def invalid_selection_rate(selected: Iterable[str], forbidden: Iterable[str]) -> float | None:
    """Forbidden selections / all selections (duplicates count); ``None`` if nothing selected."""
    sequence = list(selected)
    if not sequence:
        return None
    banned = _as_set(forbidden)
    return sum(1 for call in sequence if call in banned) / len(sequence)


def unnecessary_tool_calls(
    calls: Iterable[str], required: Iterable[str], optional: Iterable[str]
) -> int:
    """Count of calls to tools outside required ∪ optional (duplicates count)."""
    valuable = _as_set(required) | _as_set(optional)
    return sum(1 for call in calls if call not in valuable)


def bash_fallback_rate(calls: Iterable[str]) -> float | None:
    """Calls to ``bash`` / all calls; ``None`` if no calls at all."""
    sequence = list(calls)
    if not sequence:
        return None
    return sum(1 for call in sequence if call == BASH_TOOL_NAME) / len(sequence)


def task_success(
    selected: Iterable[str], required: Iterable[str], forbidden: Iterable[str]
) -> bool:
    """required ⊆ selected AND selected ∩ forbidden = ∅."""
    chosen = _as_set(selected)
    return _as_set(required) <= chosen and not chosen & _as_set(forbidden)


def capability_exposure_recall(surface: Iterable[str], required: Iterable[str]) -> float:
    """|surface ∩ required| / |required|; 1.0 when nothing is required."""
    needed = _as_set(required)
    if not needed:
        return 1.0
    return len(needed & _as_set(surface)) / len(needed)


def forbidden_exposure_rate(surface: Iterable[str], forbidden: Iterable[str]) -> float:
    """|surface ∩ forbidden| / |forbidden|; 0.0 when nothing is forbidden."""
    banned = _as_set(forbidden)
    if not banned:
        return 0.0
    return len(banned & _as_set(surface)) / len(banned)


def discovery_latency(ordered_surface: Iterable[str], required: Iterable[str]) -> int | None:
    """0-based position of the first required tool in the surface order.

    ``None`` when the surface exposes none of the required tools (the
    recall metric carries the failure; latency stays honest about the
    missing datum instead of reporting a fake maximum).
    """
    needed = _as_set(required)
    for position, name in enumerate(ordered_surface):
        if name in needed:
            return position
    return None
