"""Bounded, untrusted KG observations for an opt-in planner experiment."""

from __future__ import annotations

import json
from typing import Any

from raptix.middleware.kg_internal.store import KGStore

MAX_ROWS = 5
MAX_FIELD = 120
MAX_BLOCK = 2400


def _field(value: Any) -> str:
    if value is None:
        return ""
    return "".join(ch if ch.isprintable() else " " for ch in str(value))[:MAX_FIELD]


def build_operational_state(store: KGStore, *, engagement: str) -> str:
    """Project recorded relationships, never infer liveness or a usable foothold."""
    observations: list[dict[str, str]] = []
    queries = (
        (
            "login_relationship",
            "MATCH (src)-[r:HAS_SESSION]->(dst) "
            "WHERE src.engagement = $engagement AND dst.engagement = $engagement "
            "AND r.engagement = $engagement "
            "RETURN src.key AS source, dst.key AS target, r.source AS provenance "
            "ORDER BY source, target LIMIT $limit",
        ),
        (
            "credential_reference",
            "MATCH (c:Credential) WHERE c.engagement = $engagement "
            "RETURN 1 AS present LIMIT $limit",
        ),
        (
            "access_relationship",
            "MATCH (src)-[r:CAN_ACCESS|ADMIN_TO]->(dst) "
            "WHERE src.engagement = $engagement AND dst.engagement = $engagement "
            "AND r.engagement = $engagement "
            "RETURN src.key AS source, dst.key AS target, type(r) AS relation "
            "ORDER BY source, target LIMIT $limit",
        ),
    )
    for kind, statement in queries:
        for row in store.execute_read(statement, {"limit": MAX_ROWS}, engagement=engagement):
            item = {"kind": kind, "verified": "false"}
            if kind != "credential_reference":
                item["source"] = _field(row.get("source"))
                for key in ("target", "relation", "provenance"):
                    if row.get(key) is not None:
                        item[key] = _field(row[key])
            # Credential nodes are indicated only by presence: labels, keys
            # and provenance may themselves contain captured material.
            observations.append(item)
    if not observations:
        return ""
    prefix = (
        "OPERATIONAL STATE (EXPERIMENT, UNTRUSTED): recorded KG assertions; "
        "HAS_SESSION is a logon relationship, NOT a live managed session. "
        "No row authorizes access or proves reachability.\n"
    )
    parts = [prefix]
    for item in observations:
        line = json.dumps(item, ensure_ascii=True) + "\n"
        if len("".join(parts)) + len(line) > MAX_BLOCK:
            parts.append("[truncated: context budget reached]")
            break
        parts.append(line)
    return "".join(parts)
