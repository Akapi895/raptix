"""Pure bounded re-expansion planning for surface-exploit chaining."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

DEFAULT_MAX_GENERATIONS = 3
DEFAULT_MAX_TOTAL_CELLS = 50

_CELL_ID_RE = re.compile(r"(?:^|;\s*)cell_id=(?P<cell_id>[^;\s]+)")
_TITLE_RE = re.compile(r"^Surface exploit: (?P<vuln_class>[a-z0-9_]+) @ (?P<surface_key>.+)$")


def _cell_id(value: Mapping[str, Any]) -> str:
    explicit = value.get("cell_id")
    if explicit:
        return str(explicit)
    notes = value.get("notes")
    match = _CELL_ID_RE.search(str(notes or ""))
    if match:
        return match["cell_id"]
    title_match = _TITLE_RE.fullmatch(str(value.get("title", "")))
    if title_match:
        return f"{title_match['vuln_class']}::{title_match['surface_key']}"
    return ""


def _int_value(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _candidate_order(cell: Mapping[str, Any]) -> tuple[int, int, str]:
    priority = _int_value(cell.get("priority"), 2**31 - 1)
    generation = max(0, _int_value(cell.get("gen"), 0))
    return priority, generation, _cell_id(cell)


def plan_reexpansion(
    existing_objectives: Sequence[Mapping[str, Any]],
    derived_cells: Sequence[Mapping[str, Any]],
    *,
    base_generation: int | None = None,
    max_generations: int = DEFAULT_MAX_GENERATIONS,
    max_total_cells: int = DEFAULT_MAX_TOTAL_CELLS,
) -> list[dict[str, Any]]:
    """Return bounded, deduplicated cells derived from newly observed surfaces.

    The bounds are deliberately hard defaults: generation depth is capped at
    three and the total objective population at fifty. Callers may tune them
    per engagement, but a negative bound always yields no expansion.
    """
    if max_generations < 0 or max_total_cells <= 0:
        return []

    existing_ids = {_cell_id(objective) for objective in existing_objectives}
    candidates: list[dict[str, Any]] = []
    for derived_cell in derived_cells:
        cell = dict(derived_cell)
        cell_id = _cell_id(cell)
        if not cell_id or cell_id in existing_ids:
            continue
        generation = (
            max(0, base_generation) + 1
            if base_generation is not None
            else max(0, _int_value(cell.get("gen"), 0))
        )
        if generation > max_generations:
            continue
        cell["gen"] = generation
        candidates.append(cell)
    candidates.sort(key=_candidate_order)

    selected: list[dict[str, Any]] = []
    seen: set[str] = set(existing_ids)
    remaining = max_total_cells - len(existing_objectives)
    for cell in candidates:
        cell_id = _cell_id(cell)
        if cell_id in seen or remaining <= 0:
            break
        cell["cell_id"] = cell_id
        selected.append(cell)
        seen.add(cell_id)
        remaining -= 1
    return selected
