"""Domain mapping for every fixture the coverage matrix marks verified-data (plan phase 7).

The files come from the matrix rows, not from a list in this module, so a row that gains verified data is
covered without editing this file. Each file goes through the nmap adapter, and what it writes must agree
with the catalog rule (ADR-0094): every host and web origin carries the identity of its locator, and every
origin hangs off the host that exposes it. Provenance names the source and the episode.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from raptix.knowledge.graph.asset_identity import host_or_dns_ref, identity_props, web_origin_ref
from raptix.knowledge.graph.ingest import _adapt_nmap_xml

ROOT = Path(__file__).resolve().parents[5]
MATRIX = ROOT / "docs" / "design" / "2026-10-20-asset-map-coverage-matrix.json"
ENGAGEMENT = "eng-domain-map"
EPISODE = "episode-domain-map"


def _verified_scan_files() -> list[Path]:
    rows = json.loads(MATRIX.read_text(encoding="utf-8"))["rows"]
    files: list[Path] = []
    for row in rows:
        if row["verification"] != "verified-data":
            continue
        for entry in row["fixtures"]:
            path = ROOT / entry
            files.extend(sorted(path.glob("*.xml")) if path.is_dir() else [path])
    # Truncated output is a failure path with its own test (test_retained_nmap_outputs); it is not mapped here.
    return [path for path in files if "</nmaprun>" in path.read_text(encoding="utf-8", errors="replace")]


class _CapturingStore:
    def __init__(self) -> None:
        self.calls: list[list[dict[str, Any]]] = []
        self.episodes: list[str] = []

    def record_observations(
        self,
        observations: list[dict[str, Any]],
        *,
        engagement: str,
        created_by: str,
        source_episode_id: str,
    ) -> dict[str, Any]:
        self.calls.append(list(observations))
        self.episodes.append(source_episode_id)
        return {"created": 0, "merged": 0, "edges": 0, "revision": "capture"}


VERIFIED = _verified_scan_files()


def _written(path: Path) -> tuple[_CapturingStore, list[dict[str, Any]]]:
    store = _CapturingStore()
    result = _adapt_nmap_xml(path, store, ENGAGEMENT, "retained", EPISODE)  # type: ignore[arg-type]
    assert "error" not in result
    return store, store.calls[0]


def test_the_matrix_names_verified_scan_files() -> None:
    assert VERIFIED, "no verified-data fixture is listed in the coverage matrix"


@pytest.mark.parametrize("path", VERIFIED, ids=lambda path: path.name)
def test_hosts_and_origins_carry_the_identity_of_their_locator(path: Path) -> None:
    _, observations = _written(path)
    hosts = [obs for obs in observations if obs["kind"] == "Host"]
    origins = [obs for obs in observations if obs["kind"] == "Entrypoint"]
    # UDP-only scans yield hosts and no web origins, so origins may be empty for a verified file.
    assert hosts
    for host in hosts:
        locator = host_or_dns_ref(host["key"].removeprefix("host::"))
        assert host["props"]["asset_id"] == identity_props(ENGAGEMENT, locator)["asset_id"]
    for origin in origins:
        assert origin["props"]["asset_id"] == identity_props(ENGAGEMENT, web_origin_ref(origin["label"]))["asset_id"]


@pytest.mark.parametrize("path", VERIFIED, ids=lambda path: path.name)
def test_every_origin_hangs_off_a_host_that_exposes_it(path: Path) -> None:
    _, observations = _written(path)
    origin_keys = {obs["key"] for obs in observations if obs["kind"] == "Entrypoint"}
    linked = {
        edge["to_key"]
        for obs in observations
        if obs["kind"] == "Host"
        for edge in obs.get("edges_out", [])
        if edge["kind"] == "HAS"
    }
    assert origin_keys <= linked


@pytest.mark.parametrize("path", VERIFIED, ids=lambda path: path.name)
def test_provenance_names_the_nmap_source_and_the_episode(path: Path) -> None:
    store, observations = _written(path)
    assert store.episodes == [EPISODE]
    for obs in observations:
        if obs["kind"] in ("Host", "Entrypoint"):
            assert obs["props"]["source"] == "nmap"
