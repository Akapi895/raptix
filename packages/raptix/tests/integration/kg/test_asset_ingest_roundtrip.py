"""Live round trip: scanner output → KG asset identities → replay and concurrent ingest (ADR-0094).

Needs a reachable Neo4j (``RAPTIX_NEO4J_URI``, ``RAPTIX_NEO4J_USER``, ``RAPTIX_NEO4J_PASSWORD``);
skipped otherwise. Uses its own engagement key and removes it afterwards.
"""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from raptix.knowledge.graph.ingest import ingest
from raptix.knowledge.graph.store import KGStore
from raptix_core.types.asset import AssetKind, AssetRef, asset_id

ENGAGEMENT = "asset-map-it"

NMAP_XML = """<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <hostnames><hostname name="target.local"/></hostnames>
    <ports>
      <port portid="80" protocol="tcp"><state state="open"/><service name="http"/></port>
      <port portid="22" protocol="tcp"><state state="open"/><service name="ssh"/></port>
    </ports>
  </host>
</nmaprun>
"""

requires_neo4j = pytest.mark.skipif(
    not os.environ.get("RAPTIX_NEO4J_URI"),
    reason="live Neo4j required: set RAPTIX_NEO4J_URI, RAPTIX_NEO4J_USER, RAPTIX_NEO4J_PASSWORD",
)


@pytest.fixture
def store() -> KGStore:
    kg = KGStore.from_env()
    yield kg  # type: ignore[misc]
    kg.delete_engagement(engagement=ENGAGEMENT)
    kg.close()


def _asset_ids(kg: KGStore) -> list[str]:
    rows = kg.execute_read(
        "MATCH (n) WHERE n.engagement = $engagement AND n.asset_id IS NOT NULL RETURN n.asset_id AS id ORDER BY id",
        {},
        engagement=ENGAGEMENT,
    )
    return [row["id"] for row in rows]


def _node_count(kg: KGStore) -> int:
    rows = kg.execute_read(
        "MATCH (n) WHERE n.engagement = $engagement RETURN count(n) AS count",
        {},
        engagement=ENGAGEMENT,
    )
    return int(rows[0]["count"])


@requires_neo4j
def test_scan_yields_one_identity_per_asset(tmp_path: Path, store: KGStore) -> None:
    scan = tmp_path / "scan.xml"
    scan.write_text(NMAP_XML, encoding="utf-8")
    ingest(
        "nmap_xml",
        scan,
        store=store,
        engagement=ENGAGEMENT,
        created_by="it",
        source_episode_id="ep-1",
    )

    expected = sorted(
        [
            asset_id(ENGAGEMENT, AssetRef(AssetKind.HOST, "default", "10.0.0.1")),
            asset_id(
                ENGAGEMENT, AssetRef(AssetKind.WEB_ORIGIN, "default", "http://target.local:80")
            ),
        ]
    )
    assert _asset_ids(store) == expected


@requires_neo4j
def test_replay_and_concurrent_ingest_create_no_duplicates(tmp_path: Path, store: KGStore) -> None:
    scan = tmp_path / "scan.xml"
    scan.write_text(NMAP_XML, encoding="utf-8")
    ingest(
        "nmap_xml",
        scan,
        store=store,
        engagement=ENGAGEMENT,
        created_by="it",
        source_episode_id="ep-1",
    )
    baseline_ids = _asset_ids(store)
    baseline_nodes = _node_count(store)

    def replay(index: int) -> None:
        worker = KGStore.from_env()
        try:
            ingest(
                "nmap_xml",
                scan,
                store=worker,
                engagement=ENGAGEMENT,
                created_by="it",
                source_episode_id=f"ep-{index}",
            )
        finally:
            worker.close()

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(replay, range(2, 6)))

    assert _asset_ids(store) == baseline_ids
    assert _node_count(store) == baseline_nodes
