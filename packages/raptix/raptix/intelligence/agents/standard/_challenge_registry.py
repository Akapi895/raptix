"""Scoreboard-derived per-challenge coverage cells for the orchestrator.

The challenge inventory is a coverage backstop for the surface coverage
matrix. Some missions carry a named scoreboard (``GET /api/Challenges``
style) whose entries do not reduce to a single normalized
``(endpoint, vuln_class)`` cell: information-hunting entries that read
the application's own data, multi-step account-takeover chains, or
frame-level classes (e.g. XSS) whose win condition is one specific
named challenge rather than an endpoint proof. Without this backstop
those entries can stay at zero objectives for an entire run.

Each derived cell is scoped to **one scoreboard entry** — one
win-condition (the entry's own solved flag). That is the most objective
split available: entries, names, categories, and difficulty all come
from the target's own scoreboard, so the cell maps 1:1 onto a
verifiable outcome and a stalled or crashed cell can only lose the work
of a single entry.

Objectivity contract (see ``docs/adr/0075-challenge-inventory.md``) —
this module must stay free of target-specific content:

- Entries, categories, and difficulty are the target's own data (the
  snapshot file recon already pulls from the mission's own scoreboard
  endpoint). Nothing here encodes a payload, endpoint, credential, or
  challenge answer. Hints are deliberately NOT ingested: discovery-mode
  engagements must not be fed the target's own hint text.
- The only static table is :data:`CATEGORY_SKILL_RULES`: a generic
  keyword -> methodology-skill mapping that mirrors the platform's own
  skill taxonomy (the same skills the surface registry cites). It is
  auditable and applies to any target's category vocabulary.
- Dispatch priority derives from the target's own difficulty ranking,
  never from a hand-picked per-category order.
- Entries without a keyword match fall back to the generic
  sensitive-information-disclosure methodology instead of being
  dropped.
- Categories the RoE normally gates (availability/DoS families) are
  still generated; their priority is pinned to
  :data:`ROE_GATED_PRIORITY` so the dispatch loop only reaches them
  after every other entry is terminal, and the orchestrator records
  the RoE-cited skip reason when it declines them.
- A ``skipped``/``attempted-failed`` outcome requires bounded empirical
  evidence in the notes (a request/response showing the win condition
  is inert). Target metadata such as an availability marker is
  advisory only — never proof.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from raptix.intelligence.agents.standard._surface_registry import (
    session_name_for_cell,
)

DEFAULT_SKILL_PATH = "/skills/standard/analyst/sensitive-information-disclosure/SKILL.md"
ROE_GATED_PRIORITY = 900

# Keyword -> methodology skill. Specific keywords come before generic
# ones; the first substring match wins. Keyword matching is lowercase
# substring on the category name, so it applies to any target's category
# vocabulary (order below is the specificity order).
CATEGORY_SKILL_RULES: tuple[tuple[str, str], ...] = (
    ("cross-site scripting", "/skills/standard/exploit/web/xss/SKILL.md"),
    ("xss", "/skills/standard/exploit/web/xss/SKILL.md"),
    ("template injection", "/skills/standard/exploit/web/ssti/SKILL.md"),
    ("ssti", "/skills/standard/exploit/web/ssti/SKILL.md"),
    ("deseriali", "/skills/standard/exploit/web/deserialization/SKILL.md"),
    ("xml external", "/skills/standard/exploit/web/xxe/SKILL.md"),
    ("xxe", "/skills/standard/exploit/web/xxe/SKILL.md"),
    ("sql injection", "/skills/standard/exploit/web/sqli/SKILL.md"),
    ("nosql", "/skills/standard/exploit/web/nosqli/SKILL.md"),
    ("prompt injection", "/skills/standard/analyst/prompt-injection/SKILL.md"),
    ("system prompt", "/skills/standard/analyst/system-prompt-leakage/SKILL.md"),
    ("prompt", "/skills/standard/analyst/prompt-injection/SKILL.md"),
    ("chatbot", "/skills/standard/analyst/prompt-injection/SKILL.md"),
    ("llm", "/skills/standard/analyst/prompt-injection/SKILL.md"),
    (
        "sensitive data",
        "/skills/standard/analyst/sensitive-information-disclosure/SKILL.md",
    ),
    (
        "information disclosure",
        "/skills/standard/analyst/sensitive-information-disclosure/SKILL.md",
    ),
    (
        "data exposure",
        "/skills/standard/analyst/sensitive-information-disclosure/SKILL.md",
    ),
    (
        "broken authentication",
        "/skills/standard/exploit/web/ato-methodology/SKILL.md",
    ),
    ("account takeover", "/skills/standard/exploit/web/ato-methodology/SKILL.md"),
    ("broken access control", "/skills/standard/exploit/web/bfla/SKILL.md"),
    ("authorization", "/skills/standard/exploit/web/bfla/SKILL.md"),
    ("anti automation", "/skills/standard/exploit/web/business-logic/SKILL.md"),
    ("automation", "/skills/standard/exploit/web/business-logic/SKILL.md"),
    ("logic", "/skills/standard/exploit/web/business-logic/SKILL.md"),
    ("redirect", "/skills/standard/exploit/web/open-redirect/SKILL.md"),
    ("request forgery", "/skills/standard/exploit/web/csrf/SKILL.md"),
    ("csrf", "/skills/standard/exploit/web/csrf/SKILL.md"),
    ("cryptographic", "/skills/standard/exploit/web/crypto/SKILL.md"),
    ("crypto", "/skills/standard/exploit/web/crypto/SKILL.md"),
    ("misconfiguration", "/skills/standard/exploit/web/proxy-misconfig/SKILL.md"),
    ("injection", "/skills/standard/exploit/web/nosqli/SKILL.md"),
    (
        "obscurity",
        "/skills/standard/analyst/sensitive-information-disclosure/SKILL.md",
    ),
    (
        "observability",
        "/skills/standard/analyst/sensitive-information-disclosure/SKILL.md",
    ),
)

# Categories whose solve conditions normally conflict with a standard RoE
# (resource exhaustion / availability). Keyword-matched like the skill
# rules; these cells are generated but sorted to the tail.
ROE_GATED_CATEGORY_KEYWORDS: tuple[str, ...] = ("deseriali",)


def _slug(value: str) -> str:
    """Lowercase token safe for objective titles (``[a-z0-9_]+``)."""
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_") or "entry"


def skill_for_category(category: str) -> str:
    """Return the methodology skill for a target category name."""
    lowered = category.lower()
    for keyword, path in CATEGORY_SKILL_RULES:
        if keyword in lowered:
            return path
    return DEFAULT_SKILL_PATH


def is_roe_gated_category(category: str) -> bool:
    lowered = category.lower()
    return any(keyword in lowered for keyword in ROE_GATED_CATEGORY_KEYWORDS)


def parse_challenge_snapshot(text: str) -> list[dict[str, Any]]:
    """Parse a scoreboard snapshot into normalized challenge rows.

    Accepts either the raw API envelope (``{"data": [...]}``) or a bare
    JSON list. Rows without a usable name+category are skipped silently —
    snapshot shapes vary between targets and versions.
    """
    try:
        payload = json.loads(text)
    except (TypeError, ValueError):
        return []
    rows = payload.get("data") if isinstance(payload, Mapping) else payload
    if not isinstance(rows, list):
        return []
    challenges: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        name = str(row.get("name") or "").strip()
        category = str(row.get("category") or "").strip()
        if not name or not category:
            continue
        try:
            difficulty = int(row.get("difficulty", 0))
        except (TypeError, ValueError):
            difficulty = 0
        challenges.append(
            {
                "id": str(row.get("id") or ""),
                "key": str(row.get("key") or ""),
                "name": name,
                "category": category,
                "difficulty": max(0, difficulty),
                "solved": bool(row.get("solved")),
            }
        )
    return challenges


def find_snapshot_file(candidates: Sequence[str | Path]) -> Path | None:
    """Return the first candidate that exists as a file."""
    for candidate in candidates:
        path = Path(candidate)
        if path.is_file():
            return path
    return None


def build_challenge_cells(
    challenges: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Derive exactly one bounded cell per unsolved scoreboard entry.

    Priority is the entry's own difficulty (the target's ranking).
    RoE-gated categories are pinned to ``ROE_GATED_PRIORITY`` + the same
    difficulty so they stay ordered among themselves but only dispatch
    after every regular entry.
    """
    cells: list[dict[str, Any]] = []
    unsolved = [challenge for challenge in challenges if not challenge.get("solved")]
    unsolved.sort(
        key=lambda item: (
            int(item["difficulty"]),
            str(item["category"]).lower(),
            str(item["name"]).lower(),
        )
    )
    for challenge in unsolved:
        challenge_id = str(challenge.get("id") or _slug(str(challenge["name"])))
        name = str(challenge["name"])
        category = str(challenge["category"])
        difficulty = int(challenge["difficulty"])
        slug = _slug(f"{category}_{name}")
        vuln_class = f"challenge_{_slug(challenge_id)}"
        surface_key = f"challenge::{slug}"
        cell_id = f"{vuln_class}::{surface_key}"
        session_name = session_name_for_cell(cell_id)
        gated = is_roe_gated_category(category)
        cells.append(
            {
                "cell_id": cell_id,
                "vuln_class": vuln_class,
                "surface_key": surface_key,
                "skill_path": skill_for_category(category),
                "mitre": [],
                "tool_hints": [],
                "session": session_name,
                "session_name": session_name,
                "gen": 0,
                "status": "pending",
                "priority": (ROE_GATED_PRIORITY + difficulty if gated else difficulty),
                # ADR-0077: availability-family entries are destructive
                # (RoE-sanctioned final phase, alone); every other entry is a
                # read-class win-condition probe.
                "effects": ("destructive" if gated else "read"),
                "challenge_id": challenge_id,
                "challenge_key": str(challenge.get("key") or ""),
                "challenge_name": name,
                "category": category,
                "difficulty": difficulty,
                "roe_gated": gated,
            }
        )
    return cells


def _notes_for(cell: Mapping[str, Any]) -> str:
    notes = [
        f"cell_id={cell['cell_id']}",
        f"session_name={cell['session_name']}",
        "gen=0",
        f"challenge_id={cell['challenge_id']}",
        f"challenge_name={cell['challenge_name']}",
        f"category={cell['category']}",
        f"difficulty={cell['difficulty']}",
    ]
    if cell.get("challenge_key"):
        notes.append(f"challenge_key={cell['challenge_key']}")
    if cell.get("roe_gated"):
        notes.append(
            "roe_gated=true (dispatch only after every other entry is terminal; "
            "requires the mission RoE to permit it)"
        )
    return "; ".join(notes)


def build_challenge_children(cells: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Render per-challenge cells as ``objective_expand`` children.

    Mirrors :func:`build_objective_expand_payload`'s shape (title regex,
    ``cell_id=``/``session_name=``/``gen=`` notes, ``load /skills/...``
    description) so the existing deterministic dispatch helpers and the
    LLM dispatch loop both consume them unchanged.
    """
    children: list[dict[str, Any]] = []
    for order, cell in enumerate(cells, start=1):
        children.append(
            {
                "title": f"Surface exploit: {cell['vuln_class']} @ {cell['surface_key']}",
                "phase": "initial-access",
                "description": (
                    f"Test coverage cell {cell['cell_id']}: drive the scoreboard entry "
                    f"{cell['challenge_name']!r} (id {cell['challenge_id']}, category "
                    f"{cell['category']!r}, difficulty {cell['difficulty']}) to its solved "
                    f"flag. Use session {cell['session_name']} and load {cell['skill_path']}."
                ),
                "acceptance_criteria": [
                    f"Attempt the win condition of {cell['challenge_name']!r} with the cited "
                    "methodology; verify a planned solve via the mission oracle before "
                    "recording success.",
                    "A skipped or attempted-failed outcome requires bounded empirical "
                    "evidence in the notes (the request/response showing the win condition "
                    "is inert). Caller-supplied availability markers alone are advisory, "
                    "never proof.",
                ],
                "priority": order,
                "mitre": [],
                "owner": "surface_exploit",
                "effects": str(cell.get("effects") or "read"),
                "notes": _notes_for(cell),
            }
        )
    return children
