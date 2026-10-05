"""Engagement/KG lifecycle adapter for the plugin-owned Slither parser."""

from pathlib import Path
from typing import Any

from raptix_contracts.slither import parse_slither_json

from raptix.knowledge.graph.store import KGStore
from raptix_core.utils.logging import get_logger

log = get_logger("contracts.slither")


def ingest_slither_json(
    data: str | dict[str, Any],
    *,
    engagement: str,
    store: KGStore | None = None,
    source_episode_id: str = "slither_ingest",
) -> int:
    count, observations = parse_slither_json(data)
    if not observations:
        return 0
    owned_store = store is None
    target_store = store if store is not None else KGStore.from_env()
    try:
        target_store.record_observations(
            observations,
            engagement=engagement,
            created_by="slither_ingest",
            source_episode_id=source_episode_id,
        )
    finally:
        if owned_store:
            target_store.close()
    return count


def ingest_slither_file(
    path: str | Path,
    *,
    engagement: str,
    store: KGStore | None = None,
    source_episode_id: str = "slither_ingest",
) -> int:
    try:
        data = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        log.warning("slither file read failed: %s", exc)
        return 0
    return ingest_slither_json(
        data, engagement=engagement, store=store, source_episode_id=source_episode_id
    )
