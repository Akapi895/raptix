"""The nmap writer against scan output retained from real lab runs (plan phase 7, network row).

The fixtures are the XML files the benchmark runs wrote against lab hosts, copied unchanged into
``apps/web/tests/fixtures/asset-map/network/htb-lab/``. Expected counts come from a regex over the
raw XML, not from the writer, so the parser is checked against the file itself.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from raptix.knowledge.graph.ingest import _adapt_nmap_xml

FIXTURES = (
    Path(__file__).resolve().parents[5]
    / "apps"
    / "web"
    / "tests"
    / "fixtures"
    / "asset-map"
    / "network"
    / "htb-lab"
)

COMPLETE = sorted(
    path
    for path in FIXTURES.glob("*.xml")
    if "</nmaprun>" in path.read_text(encoding="utf-8", errors="replace")
)
TRUNCATED = [path for path in FIXTURES.glob("*.xml") if path not in COMPLETE]


class _CapturingStore:
    def __init__(self) -> None:
        self.calls: list[list[dict[str, Any]]] = []

    def record_observations(
        self,
        observations: list[dict[str, Any]],
        *,
        engagement: str,
        created_by: str,
        source_episode_id: str,
    ) -> dict[str, Any]:
        self.calls.append(list(observations))
        return {"created": 0, "merged": 0, "edges": 0, "revision": "capture"}


def _independent_counts(path: Path) -> tuple[int, int]:
    text = path.read_text(encoding="utf-8")
    # Only a <status> directly inside a <host> counts; <hosthint> repeats the status and is not a host.
    hosts_up = len(re.findall(r'<host\b[^>]*>\s*<status state="up"', text))
    open_ports = len(re.findall(r'<port protocol="[a-z]+" portid="\d+"><state state="open"', text))
    return hosts_up, open_ports


def test_fixtures_are_present() -> None:
    assert len(COMPLETE) == 8
    assert len(TRUNCATED) == 1


@pytest.mark.parametrize("path", COMPLETE, ids=lambda path: path.name)
def test_complete_scan_output_matches_the_raw_xml(path: Path) -> None:
    store = _CapturingStore()
    result = _adapt_nmap_xml(path, store, "htb-lab", "retained", "ep")  # type: ignore[arg-type]
    hosts_up, open_ports = _independent_counts(path)
    assert "error" not in result
    assert result["hosts"] == hosts_up
    assert result["services"] == open_ports


def test_truncated_scan_output_is_refused_without_writing_anything() -> None:
    store = _CapturingStore()
    result = _adapt_nmap_xml(TRUNCATED[0], store, "htb-lab", "retained", "ep")  # type: ignore[arg-type]
    assert "no element found" in result["error"]
    assert store.calls == []
