"""Structured operational-state projection (shadow mode) — Step 5, ADR-0032.

``KGMiddleware`` builds this block alongside ``kg_summary`` and injects
it as a trailing system-message block headed ``OPERATIONAL STATE
(SHADOW)``. Read-only: it projects what the graph already records —
access sessions, credentials, direct reachability — into a structured,
planner-friendly view. It never rejects or rewrites actions; per
ADR-0032 it only becomes load-bearing after a T2 benchmark shows the
planner picks better source sessions / preconditions with it.

Sections (all optional, dropped when empty):

  1. Access — ``HAS_SESSION`` edges (computer → user) with
     ``logon_type`` / ``privileged`` / ``source`` edge props.
  2. Credentials — ``Credential`` nodes with their authenticated
     principal and ``source`` / ``protocol`` / ``target`` /
     ``secret_type`` / ``admin`` props (written by the cme ingest).
  3. Reachability — direct ``CAN_ACCESS`` / ``ADMIN_TO`` edges
     (principal → target).

Only facts present in the graph are rendered; nothing is inferred
(the shadow experiment needs "same facts, structured" to stay a fair
comparison against the narrative summary). ``recent_failures`` from
the audit prescription is deferred until failure outcomes are recorded
in the KG — see ADR-0032.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from raptix.middleware.kg_internal.store import KGStore

# ── Section size budgets ────────────────────────────────────────────────

MAX_ACCESS_ROWS = 5
MAX_CREDENTIAL_ROWS = 10
MAX_REACH_ROWS = 10

# Header for the injected block. "SHADOW" marks it as advisory context —
# actions are never gated on it (ADR-0032).
BLOCK_HEADER = "## OPERATIONAL STATE (SHADOW)"

# Credential principals are a convenience, not a table — cap per row.
MAX_PRINCIPALS_PER_CREDENTIAL = 3


def _text(value: Any) -> str:
    """Coerce an optional KG prop to a stripped display string."""
    if value is None:
        return ""
    return str(value).strip()


# ── Section queries ────────────────────────────────────────────────────


def _access_rows(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """Sessions recorded as ``HAS_SESSION`` edges (computer → user)."""
    rows = store.execute_read(
        (
            "MATCH (src)-[e:HAS_SESSION]->(dst) "
            "WHERE src.engagement = $engagement AND e.engagement = $engagement "
            "  AND dst.engagement = $engagement "
            "RETURN coalesce(src.label, src.key) AS source_asset, "
            "       coalesce(dst.label, dst.key) AS principal, "
            "       e.logon_type AS logon_type, "
            "       e.privileged AS privileged, "
            "       e.source AS session_source "
            "LIMIT $cap"
        ),
        {"engagement": engagement, "cap": MAX_ACCESS_ROWS},
        engagement=engagement,
    )
    return list(rows)


def _credential_rows(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """Credentials with their authenticated principal and provenance."""
    rows = store.execute_read(
        (
            "MATCH (c:Credential) WHERE c.engagement = $engagement "
            "OPTIONAL MATCH (c)-[:AUTHENTICATES_TO {engagement: $engagement}]->(u) "
            "RETURN coalesce(c.label, c.key) AS label, "
            "       c.source AS source, "
            "       c.protocol AS protocol, "
            "       c.target AS target, "
            "       c.secret_type AS secret_type, "
            "       c.admin AS admin, "
            "       collect(DISTINCT coalesce(u.label, u.key)) AS principals "
            "LIMIT $cap"
        ),
        {"engagement": engagement, "cap": MAX_CREDENTIAL_ROWS},
        engagement=engagement,
    )
    return list(rows)


def _reachability_rows(store: KGStore, *, engagement: str) -> list[dict[str, Any]]:
    """Direct access edges — principal → target primitives.

    ``REACHES`` is deliberately excluded: it is a derived crown-jewel
    chain edge already surfaced by the summary's crown-jewel section.
    """
    rows = store.execute_read(
        (
            "MATCH (src)-[e:CAN_ACCESS|ADMIN_TO]->(dst) "
            "WHERE src.engagement = $engagement AND e.engagement = $engagement "
            "  AND dst.engagement = $engagement "
            "RETURN coalesce(src.label, src.key) AS principal, "
            "       coalesce(dst.label, dst.key) AS target, "
            "       type(e) AS edge_kind "
            "LIMIT $cap"
        ),
        {"engagement": engagement, "cap": MAX_REACH_ROWS},
        engagement=engagement,
    )
    result = list(rows)
    result.sort(key=lambda r: (str(r.get("edge_kind") or ""), str(r.get("principal") or "")))
    return result


# ── Markdown rendering ─────────────────────────────────────────────────


def _render_access(rows: Iterable[Mapping[str, Any]]) -> str:
    lines = ["**Access (recorded sessions)**:"]
    for row in rows:
        principal = row.get("principal") or "?"
        asset = row.get("source_asset") or "?"
        bits: list[str] = []
        logon_type = _text(row.get("logon_type"))
        if logon_type:
            bits.append(f"logon_type={logon_type}")
        if row.get("privileged"):
            bits.append("privileged")
        session_source = _text(row.get("session_source"))
        if session_source:
            bits.append(f"source={session_source}")
        suffix = f" ({', '.join(bits)})" if bits else ""
        lines.append(f"- {principal} @ {asset}{suffix}")
    return "\n".join(lines)


def _render_credentials(rows: Iterable[Mapping[str, Any]]) -> str:
    lines = ["**Credentials**:"]
    for row in rows:
        label = row.get("label") or "?"
        bits: list[str] = []
        for prop in ("protocol", "target", "secret_type"):
            value = _text(row.get(prop))
            if value:
                bits.append(f"{prop}={value}")
        source = _text(row.get("source"))
        if source:
            bits.append(f"source={source}")
        if row.get("admin"):
            bits.append("admin")
        suffix = f" ({', '.join(bits)})" if bits else ""
        principals = [str(p) for p in (row.get("principals") or []) if p]
        principal_txt = ""
        if principals:
            shown = principals[:MAX_PRINCIPALS_PER_CREDENTIAL]
            principal_txt = " → " + " | ".join(shown)
        lines.append(f"- `{label}`{suffix}{principal_txt}")
    return "\n".join(lines)


def _render_reachability(rows: Iterable[Mapping[str, Any]]) -> str:
    lines = ["**Reachability (direct access edges)**:"]
    for row in rows:
        principal = row.get("principal") or "?"
        target = row.get("target") or "?"
        kind = row.get("edge_kind") or "?"
        lines.append(f"- {principal} -[{kind}]-> {target}")
    return "\n".join(lines)


# ── Public entry point ─────────────────────────────────────────────────


def build_operational_state(store: KGStore, *, engagement: str) -> str:
    """Build the shadow operational-state markdown block.

    Returns ``""`` when the graph records no access, credential, or
    reachability rows — the caller then injects nothing. Query failures
    propagate to the caller's fail-safe handler (logged, block dropped,
    narrative summary unaffected).
    """
    sections: list[str] = []

    access = _access_rows(store, engagement=engagement)
    if access:
        sections.append(_render_access(access))

    credentials = _credential_rows(store, engagement=engagement)
    if credentials:
        sections.append(_render_credentials(credentials))

    reachability = _reachability_rows(store, engagement=engagement)
    if reachability:
        sections.append(_render_reachability(reachability))

    if not sections:
        return ""
    return BLOCK_HEADER + "\n" + "\n".join(sections)
