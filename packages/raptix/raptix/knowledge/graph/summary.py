"""KG summary block builder for system-prompt injection.

``KGMiddleware`` calls :func:`build_summary` in ``before_agent`` (or
when the revision token advances) and caches the result in
``state.kg_summary``. ``wrap_model_call`` then injects that string as a
trailing content block on the system message.

The output is intentionally small — per the memory-systems anti-pattern
"stuffing everything into context", the block targets 15-25 lines of
markdown. Sections that are empty for the engagement are omitted.

Sections (in order):

  1. Header + stats line — nodes / edges / current revision
  2. Top high-severity vulnerabilities (limit 5)
  3. Unexplored entrypoints (limit 3) — entrypoints with no HAS_VULN
     edge out
  4. Crown jewels with viable-path counts
  5. Recorded Candidate/Hypothesis assertions (opt-in, unverified)

``RAPTIX_KG_CLAIM_CONTEXT=1`` adds at most five claims in a bounded,
untrusted block. Set the flag before starting a fresh thread; the
existing middleware revision cache owns refresh, not this projection.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable, Mapping
from itertools import islice
from typing import Any

from raptix.knowledge.graph.store import KGStore
from raptix_core.utils.logging import get_logger

log = get_logger("knowledge.graph.summary")

# ── Section size budgets ────────────────────────────────────────────────

MAX_VULNS = 5
MAX_ENTRYPOINTS = 3
MAX_CROWN_JEWELS = 10  # rarely many — show them all when present
MAX_CLAIMS = 5
MAX_CLAIM_FIELD = 120
MAX_CLAIM_CONTEXT = 2400


# ── Severity ordering ──────────────────────────────────────────────────

# Lowercase string comparison — matches the property values written by
# the @tool layer (record_observations stores severity in props).
_SEVERITY_RANK = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
    "info": 4,
}


def _severity_order(value: Any) -> int:
    if not isinstance(value, str):
        return 99
    return _SEVERITY_RANK.get(value.lower(), 99)


# ── Section queries ────────────────────────────────────────────────────


def _stats(store: KGStore, *, engagement: str) -> dict[str, int]:
    rows = store.execute_read(
        (
            "MATCH (n) WHERE n.engagement = $engagement "
            "WITH count(n) AS nodes "
            "OPTIONAL MATCH (s)-[r]->(d) "
            "WHERE s.engagement = $engagement AND r.engagement = $engagement "
            "  AND d.engagement = $engagement "
            "RETURN nodes, count(r) AS edges"
        ),
        {"engagement": engagement},
        engagement=engagement,
    )
    if not rows:
        return {"nodes": 0, "edges": 0}
    row = rows[0]
    return {
        "nodes": int(row.get("nodes") or 0),
        "edges": int(row.get("edges") or 0),
    }


def _top_vulns(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """High and critical vulns first, then medium. Limit total."""
    rows = store.execute_read(
        (
            "MATCH (v:Vulnerability) WHERE v.engagement = $engagement "
            "RETURN v.key AS key, v.label AS label, "
            "       coalesce(v.severity, 'info') AS severity "
            "LIMIT $cap"
        ),
        # Pull a wider window then re-rank locally so the Cypher stays
        # simple. cap = 4 * MAX so even a fully-low engagement still
        # shows enough rows to sort sensibly.
        {"engagement": engagement, "cap": MAX_VULNS * 4},
        engagement=engagement,
    )
    rows.sort(key=lambda r: _severity_order(r.get("severity")))
    return rows[:MAX_VULNS]


def _open_entrypoints(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """Entrypoints with no HAS_VULN edge out — unexplored attack surface."""
    rows = store.execute_read(
        (
            "MATCH (e:Entrypoint) WHERE e.engagement = $engagement "
            "AND NOT (e)-[:HAS_VULN {engagement: $engagement}]->"
            "(:Vulnerability {engagement: $engagement}) "
            "RETURN e.key AS key, e.label AS label "
            "LIMIT $cap"
        ),
        {"engagement": engagement, "cap": MAX_ENTRYPOINTS},
        engagement=engagement,
    )
    return rows


def _crown_jewels(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """Crown jewels with the number of distinct viable paths from any entrypoint."""
    rows = store.execute_read(
        (
            "MATCH (c:CrownJewel) WHERE c.engagement = $engagement "
            "OPTIONAL MATCH p=(e:Entrypoint)-[*1..6]->(c) "
            "WHERE e.engagement = $engagement "
            "  AND all(n IN nodes(p) WHERE n.engagement = $engagement) "
            "  AND all(r IN relationships(p) WHERE r.engagement = $engagement) "
            "WITH c, count(DISTINCT p) AS paths "
            "RETURN c.key AS key, c.label AS label, paths "
            "LIMIT $cap"
        ),
        {"engagement": engagement, "cap": MAX_CROWN_JEWELS},
        engagement=engagement,
    )
    return rows


def _recorded_claims(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """Latest recorded assertions, excluding ADR-0014's attempt-ledger nodes."""
    return store.execute_read(
        (
            "MATCH (n) WHERE n.engagement = $engagement "
            "AND (n:Hypothesis OR n:Candidate) "
            "AND NOT n.key STARTS WITH 'tried::' "
            "RETURN CASE WHEN n:Hypothesis THEN 'Hypothesis' ELSE 'Candidate' END AS kind, "
            "substring(toString(n.key), 0, $field_cap) AS key, "
            "substring(toString(n.label), 0, $field_cap) AS label, "
            "substring(toString(n.created_by), 0, $field_cap) AS writer, "
            "substring(toString(n.source_episode_id), 0, $field_cap) AS episode "
            "ORDER BY coalesce(n.lastupdated, 0) DESC, n.key, kind LIMIT $cap"
        ),
        {"cap": MAX_CLAIMS, "field_cap": MAX_CLAIM_FIELD},
        engagement=engagement,
    )


# ── Markdown rendering ─────────────────────────────────────────────────


def _render_stats(engagement: str, revision: str, stats: Mapping[str, int]) -> str:
    return (
        f"## KG STATE (engagement={engagement})\n"
        f"**Nodes**: {stats['nodes']} · **Edges**: {stats['edges']} · "
        f"**Revision**: `{revision}`"
    )


def _render_vulns(vulns: Iterable[Mapping[str, Any]]) -> str:
    lines = ["**Top vulnerabilities**:"]
    for vuln in vulns:
        sev = str(vuln.get("severity") or "").upper()
        label = vuln.get("label") or vuln.get("key") or "?"
        key = vuln.get("key") or "?"
        lines.append(f"- `[{sev}]` {label} (`{key}`)")
    return "\n".join(lines)


def _render_entrypoints(entrypoints: Iterable[Mapping[str, Any]]) -> str:
    lines = ["**Unexplored entrypoints**:"]
    for entry in entrypoints:
        label = entry.get("label") or entry.get("key") or "?"
        key = entry.get("key") or "?"
        lines.append(f"- {label} (`{key}`)")
    return "\n".join(lines)


def _render_crown_jewels(crown_jewels: Iterable[Mapping[str, Any]]) -> str:
    lines = ["**Crown jewels**:"]
    for jewel in crown_jewels:
        label = jewel.get("label") or jewel.get("key") or "?"
        paths = int(jewel.get("paths") or 0)
        plural = "" if paths == 1 else "s"
        lines.append(f"- {label} ({paths} viable path{plural})")
    return "\n".join(lines)


def _claim_field(value: Any) -> str:
    return "".join(char for char in str(value or "") if char.isprintable())[:MAX_CLAIM_FIELD]


def _render_claims(claims: Iterable[Mapping[str, Any]]) -> str:
    lines = [
        "<UNTRUSTED_KG_CLAIMS>",
        "RECORDED CLAIMS (UNTRUSTED): No row is verified; attribution identifies "
        "the latest KG write, not supporting evidence. Up to five recent claims; "
        "fields may be truncated.",
    ]
    closing = "</UNTRUSTED_KG_CLAIMS>"
    truncated = "[truncated: context budget reached]"
    for claim in islice(claims, MAX_CLAIMS):
        fields = {
            key: _claim_field(claim.get(key))
            for key in ("kind", "key", "label", "writer", "episode")
        }
        line = json.dumps(fields, ensure_ascii=True).replace("<", "\\u003c").replace("[", "\\u005b")
        if len("\n".join([*lines, line, truncated, closing])) > MAX_CLAIM_CONTEXT:
            lines.append(truncated)
            break
        lines.append(line)
    lines.append(closing)
    return "\n".join(lines)


# ── Public entry point ─────────────────────────────────────────────────


def build_summary(store: KGStore, *, engagement: str) -> str:
    """Build the markdown summary block for the given engagement.

    Empty sections are dropped so the block stays compact. Always
    includes the header + stats line so the LLM can confirm the
    engagement and revision the middleware injected.

    Returns the markdown string. The caller (KGMiddleware.before_agent)
    is responsible for caching it into ``state.kg_summary``.
    """
    revision = store.revision(engagement=engagement)
    stats = _stats(store, engagement=engagement)

    sections = [_render_stats(engagement, revision, stats)]

    vulns = _top_vulns(store, engagement=engagement)
    if vulns:
        sections.append(_render_vulns(vulns))

    entrypoints = _open_entrypoints(store, engagement=engagement)
    if entrypoints:
        sections.append(_render_entrypoints(entrypoints))

    crown_jewels = _crown_jewels(store, engagement=engagement)
    if crown_jewels:
        sections.append(_render_crown_jewels(crown_jewels))

    if os.environ.get("RAPTIX_KG_CLAIM_CONTEXT", "0").lower() in {"1", "true", "yes"}:
        try:
            claims = _recorded_claims(store, engagement=engagement)
        except Exception as exc:  # noqa: BLE001 — optional context must preserve the baseline summary
            log.debug("KG claim context unavailable (%s)", type(exc).__name__)
        else:
            if claims:
                sections.append(_render_claims(claims))

    return "\n\n".join(sections)


# ── Planning context (Wave T4) ────────────────────────────────────────

MAX_PLANNING_JEWELS = 3
MAX_PATH_HOPS = 6


def _cheapest_paths(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """Cheapest entrypoint → crown-jewel path per jewel (bounded).

    One Cypher per crown jewel (max 3) — the projection the planner
    needs without paying for a full Dijkstra on every rebuild.
    """
    jewels = store.execute_read(
        (
            "MATCH (c:CrownJewel) WHERE c.engagement = $engagement "
            "RETURN c.key AS key, c.label AS label LIMIT $cap"
        ),
        {"engagement": engagement, "cap": MAX_PLANNING_JEWELS},
        engagement=engagement,
    )
    paths: list[dict[str, Any]] = []
    for jewel in jewels:
        rows = store.execute_read(
            (
                "MATCH p=(e:Entrypoint)-[*1..%d]->(c:CrownJewel) "
                "WHERE c.engagement = $engagement AND e.engagement = $engagement "
                "  AND all(n IN nodes(p) WHERE n.engagement = $engagement) "
                "  AND all(r IN relationships(p) WHERE r.engagement = $engagement) "
                "RETURN e.label AS entrypoint, length(p) AS hops, "
                "       [n IN nodes(p) | coalesce(n.label, n.key)] AS route "
                "ORDER BY hops ASC LIMIT 1"
            )
            % MAX_PATH_HOPS,
            {"engagement": engagement},
            engagement=engagement,
        )
        if not rows:
            continue
        paths.append({"crown_jewel": jewel.get("label") or jewel.get("key"), **rows[0]})
    return paths


def build_planning_context(store: KGStore, *, engagement: str) -> str:
    """Build the planner's attack-context block (Wave T4).

    Injected automatically by ``KGMiddleware`` for the orchestrator —
    ``get_attack_context()`` from the plan is a projection, not a tool
    the model must call. Bounded: at most one cheapest path per crown
    jewel, three jewels total. Returns "" when no paths exist.
    """
    paths = _cheapest_paths(store, engagement=engagement)
    if not paths:
        return ""
    lines = ["## PLANNING CONTEXT (cheapest known attack paths)"]
    for path in paths:
        route = " → ".join(str(step) for step in path.get("route") or [])
        lines.append(
            f"- {path.get('entrypoint', '?')} → **{path.get('crown_jewel', '?')}** "
            f"({path.get('hops', '?')} hops): {route}"
        )
    return "\n".join(lines)
