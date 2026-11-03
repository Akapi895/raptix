"""Validate observation writes and attach server-owned source classifications."""

from __future__ import annotations

import json
import re
from typing import Any

CHANNEL_RANK = {
    "legacy_unknown": 0,
    "agent_authored": 0,
    "execution_ledger": 0,
    "tool_ingest": 1,
    "tool_autoingest": 1,
}
RESERVED = frozenset(
    {
        "key",
        "label",
        "engagement",
        "firstseen",
        "lastupdated",
        "created_by",
        "source_episode_id",
        "provenance_channel",
        "trust_rank",
        "trust_state",
        "observation_id",
        "_jc",
        "conflict_detected",
        "previous_status",
        "previous_version",
        "previous_severity",
        "previous_source_episode_id",
    }
)
PRIVATE_FIELDS = frozenset(
    {
        "raw",
        "raw_output",
        "stdout",
        "stderr",
        "password",
        "secret",
        "token",
        "private_key",
        "access_token",
        "refresh_token",
        "authorization",
    }
)
PROTECTED_LABELS = frozenset(
    {"KGRevision", "MigrationLog", "Skill", "Phase", "Tag", "MoC", "Tactic"}
)
MAX_OBSERVATIONS = 2000
MAX_BATCH_BYTES = 2_000_000


def redact_graph_text(value: str) -> str:
    from raptix.knowledge.graph.asset_identity import redact_text

    return re.sub(
        r"https?://[^\s<>\"']+",
        lambda match: redact_text(match.group()),
        value,
        flags=re.IGNORECASE,
    )


def sanitize_properties(value: dict[str, Any]) -> dict[str, Any]:
    def clean(entry: Any) -> Any:
        if isinstance(entry, dict):
            return sanitize_properties(entry)
        if isinstance(entry, list):
            return [clean(element) for element in entry]
        return redact_graph_text(entry) if isinstance(entry, str) else entry

    return {
        key: clean(entry)
        for key, entry in value.items()
        if isinstance(key, str) and key.lower() not in RESERVED | PRIVATE_FIELDS
    }


def validate_batch(observations: list[dict[str, Any]], channel: str) -> None:
    if channel not in CHANNEL_RANK:
        raise ValueError("unknown observation provenance channel")
    if len(observations) > MAX_OBSERVATIONS:
        raise ValueError("observation batch exceeds 2000 records")
    if len(json.dumps(observations, default=str).encode()) > MAX_BATCH_BYTES:
        raise ValueError("observation batch exceeds 2 MB")
    for observation in observations:
        if not isinstance(observation, dict):
            raise ValueError("every observation must be an object")
        kind = observation.get("kind", "")
        if not isinstance(kind, str) or kind.startswith("Krg") or kind in PROTECTED_LABELS:
            raise ValueError("observation label belongs to a different graph")
        if channel == "agent_authored":
            from raptix_core.types.kg import EdgeKind, NodeKind

            NodeKind(kind)
            for edge in observation.get("edges_out") or []:
                if isinstance(edge, dict):
                    EdgeKind(edge.get("kind", ""))
        key = observation.get("key")
        if not isinstance(key, str) or not key:
            raise ValueError("observation missing mandatory 'key' (deterministic dedup)")
        if len(key) > 2048:
            raise ValueError("observation key exceeds 2048 characters")
        if not isinstance(observation.get("props", {}), dict):
            raise ValueError("observation props must be an object")
        edges = observation.get("edges_out") or []
        if not isinstance(edges, list) or len(edges) > 100:
            raise ValueError("observation edges_out must contain at most 100 edges")
        if any(
            not isinstance(edge, dict)
            or not isinstance(edge.get("to_key"), str)
            or not edge["to_key"]
            for edge in edges
        ):
            raise ValueError("every edge must have a destination key")


class ChannelStore:
    """Bind an ingestion adapter to a trusted channel without changing its parsers."""

    def __init__(self, store: Any, channel: str) -> None:
        self._store = store
        self._channel = channel

    def record_observations(self, observations: Any, **scope: Any) -> dict[str, Any]:
        return self._store.record_observations(
            observations, **{**scope, "provenance_channel": self._channel}
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._store, name)
