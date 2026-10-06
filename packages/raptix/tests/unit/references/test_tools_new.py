"""Smoke tests for the references services and the remaining planner tool.

Wave T5 demoted the corpus wrappers to plain functions — they are now
called directly. ``killchain_suggest`` keeps its ``@tool`` (planner
control-plane surface) and is still exercised through ``.invoke``.
Cache is pointed at ``tmp_path`` via the ``RAPTIX_REFERENCES_ROOT``
env var so no real filesystem state is touched.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import raptix.execution.tools.references.cve_poc_index as cve_poc_index
import raptix.execution.tools.references.h1_corpus as h1_corpus
import raptix.execution.tools.references.killchain as killchain_mod
import raptix.execution.tools.references.methodology as methodology_mod
import raptix.execution.tools.references.oneliners as oneliners_mod
import raptix.execution.tools.references.payloads_ingest as payloads_ingest
from raptix.execution.tools.references import tools as T
from raptix.execution.tools.references.fetch import cache_path


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Force every module under test to use ``tmp_path`` as the cache root.

    The module-level ``cache_path`` helper reads ``CACHE_ROOT`` at call
    time only when ``root=None`` — so we monkey-patch the helper inside
    every module that uses it, redirecting to ``tmp_path``.
    """
    original = cache_path

    def fake_cache_path(slug: str, *, root: Path | None = None) -> Path:
        return original(slug, root=root or tmp_path)

    for mod in (
        payloads_ingest,
        cve_poc_index,
        h1_corpus,
        oneliners_mod,
        killchain_mod,
        methodology_mod,
    ):
        monkeypatch.setattr(mod, "cache_path", fake_cache_path)
    return tmp_path


def _load(result: str) -> dict:
    """Parse a tool result and unwrap the untrusted-corpus envelope when present."""
    data = json.loads(result)
    if isinstance(data, dict) and data.get("trust") == "untrusted-external-corpus":
        return data.get("data", {})
    return data


class TestPayloadSearchService:
    def test_default_returns_bundled(self) -> None:
        data = _load(T.payload_search())
        assert data["count"] > 0
        assert any(p["vuln_class"] == "ssrf" for p in data["payloads"])

    def test_filter_by_class(self) -> None:
        data = _load(T.payload_search(vuln_class="sqli"))
        assert data["count"] > 0
        assert all(p["vuln_class"] == "sqli" for p in data["payloads"])

    def test_class_listing(self) -> None:
        data = _load(T.payload_classes())
        classes = {c["vuln_class"] for c in data["classes"]}
        assert "ssrf" in classes
        assert "jwt" in classes


class TestCvePocLookupService:
    def test_empty_cache_returns_empty(self) -> None:
        data = _load(T.cve_poc_lookup("CVE-2099-0001"))
        assert data["count"] == 0
        assert data["poc_urls"] == []

    def test_populated_cache(self, tmp_path: Path) -> None:
        year = tmp_path / "trickest-cve" / "2024"
        year.mkdir(parents=True)
        (year / "CVE-2024-0001.md").write_text(
            "PoC: https://github.com/alice/poc-cve-2024-0001\n",
            encoding="utf-8",
        )
        data = _load(T.cve_poc_lookup("CVE-2024-0001"))
        assert data["count"] >= 1
        assert any("alice/poc" in u for u in data["poc_urls"])


class TestH1SearchService:
    def test_empty_cache(self) -> None:
        data = _load(T.h1_search(cwe="CWE-918"))
        assert data["count"] == 0

    def test_populated_cache(self, tmp_path: Path) -> None:
        repo = tmp_path / "hackerone-reports"
        repo.mkdir(parents=True)
        (repo / "tops_by_bounty.md").write_text(
            "| Title | Program | Bounty | Severity | CWE |\n"
            "|-------|---------|--------|----------|-----|\n"
            "| [SSRF report](https://hackerone.com/reports/1) | Ex | $9000 | high | CWE-918 |\n",
            encoding="utf-8",
        )
        data = _load(T.h1_search(cwe="CWE-918"))
        assert data["count"] == 1
        assert data["reports"][0]["bounty"] == 9000.0


class TestOnelinerSearchService:
    def test_empty_cache(self) -> None:
        data = _load(T.oneliner_search("tcpdump"))
        assert data["count"] == 0

    def test_populated_cache(self, tmp_path: Path) -> None:
        repo = tmp_path / "book-of-secret-knowledge"
        repo.mkdir(parents=True)
        (repo / "README.md").write_text(
            "# Book\n\n## tcpdump usage\n\nCapture:\n\n```\ntcpdump -i eth0 port 53\n```\n",
            encoding="utf-8",
        )
        data = _load(T.oneliner_search("tcpdump"))
        assert data["count"] >= 1


class TestKillchainTools:
    def test_lookup_uses_fallback(self) -> None:
        data = _load(T.killchain_lookup("recon"))
        assert data["count"] > 0
        names = {t["name"] for t in data["tools"]}
        assert "nmap" in names

    def test_suggest_keyword(self) -> None:
        data = _load(T.killchain_suggest.invoke({"objective": "brute force kerberos"}))
        assert data["count"] > 0


class TestMethodologyService:
    def test_empty_cache(self) -> None:
        data = _load(T.methodology_lookup("ssrf"))
        assert data["count"] == 0

    def test_populated(self, tmp_path: Path) -> None:
        repo = tmp_path / "all-about-bug-bounty"
        repo.mkdir(parents=True)
        (repo / "SSRF.md").write_text("# SSRF\n\nProbe metadata endpoints.\n", encoding="utf-8")
        data = _load(T.methodology_lookup("ssrf"))
        assert data["count"] == 1
        assert "metadata" in data["chapters"][0]["excerpt"].lower()
