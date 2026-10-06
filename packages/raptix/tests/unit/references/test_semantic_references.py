"""Tests for the Wave T5 semantic reference tools.

``research_cve`` / ``search_security_references`` / ``lookup_payload``
are the consolidated agent-facing reference surface; the corpus
fan-out is automatic. Cache is pointed at ``tmp_path`` so no real
filesystem state is touched.
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
import raptix.execution.tools.references.semantic as S
from raptix.execution.tools.references.fetch import cache_path
from raptix.execution.tools.references.semantic import (
    lookup_payload,
    research_cve,
    search_security_references,
)
from raptix.execution.tools.references.tools import REFERENCES_TOOLS


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Force every corpus module to use ``tmp_path`` as the cache root."""
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


class TestSurfaceList:
    def test_references_tools_are_exactly_the_three_semantic_tools(self) -> None:
        assert [t.name for t in REFERENCES_TOOLS] == [
            "research_cve",
            "search_security_references",
            "lookup_payload",
        ]

    def test_tool_export_has_description_and_args_schema(self) -> None:
        for tool in REFERENCES_TOOLS:
            assert tool.description, f"{tool.name} has no description"
            assert tool.args_schema is not None


class TestResearchCve:
    def test_no_cve_id_in_query_returns_error_with_hint(self) -> None:
        result = json.loads(research_cve.invoke({"query": "log4shell"}))
        assert "error" in result
        assert "no CVE id" in result["error"]
        assert "CVE-2021-44228" in result["hint"]

    def test_populated_cache_returns_poc_urls(self, tmp_path: Path) -> None:
        year = tmp_path / "trickest-cve" / "2021"
        year.mkdir(parents=True)
        (year / "CVE-2021-44228.md").write_text(
            "PoC: https://github.com/alice/log4shell-poc\n",
            encoding="utf-8",
        )
        result = json.loads(research_cve.invoke({"query": "CVE-2021-44228"}))
        assert result["not_found"] == []
        assert result["found"][0]["cve_id"] == "CVE-2021-44228"
        assert any("alice/log4shell-poc" in u for u in result["found"][0]["poc_urls"])

    def test_multiple_ids_fan_out_to_found_and_missing(self, tmp_path: Path) -> None:
        year = tmp_path / "trickest-cve" / "2021"
        year.mkdir(parents=True)
        (year / "CVE-2021-44228.md").write_text(
            "PoC: https://github.com/alice/poc\n",
            encoding="utf-8",
        )
        result = json.loads(research_cve.invoke({"query": "cve-2021-44228 or CVE-2099-0001"}))
        assert [f["cve_id"] for f in result["found"]] == ["CVE-2021-44228"]
        assert result["not_found"] == ["CVE-2099-0001"]


class TestSearchSecurityReferences:
    def test_short_query_rejected(self) -> None:
        result = json.loads(search_security_references.invoke({"query": "x"}))
        assert "error" in result
        assert "at least 2 characters" in result["error"]

    def test_default_fans_out_to_all_four_kinds(self) -> None:
        result = json.loads(search_security_references.invoke({"query": "ssrf imds"}))
        assert result["kinds"] == ["h1", "oneliner", "methodology", "killchain"]
        assert set(result["results"]) == {"h1", "oneliner", "methodology", "killchain"}
        # External-corpus sections keep the trust envelope; killchain is
        # local curated data and stays plain.
        for kind in ("h1", "oneliner", "methodology"):
            assert result["results"][kind]["trust"] == "untrusted-external-corpus"
        assert result["results"]["killchain"]["objective"] == "ssrf imds"

    def test_kinds_subset_limits_fan_out(self) -> None:
        result = json.loads(
            search_security_references.invoke({"query": "enumerate SMB", "kinds": ["killchain"]})
        )
        assert result["kinds"] == ["killchain"]
        assert set(result["results"]) == {"killchain"}
        assert result["results"]["killchain"]["count"] > 0

    def test_unknown_kinds_rejected_with_valid_list(self) -> None:
        result = json.loads(
            search_security_references.invoke({"query": "ssrf", "kinds": ["gopher"]})
        )
        assert "unknown kinds" in result["error"]
        assert set(result["valid"]) == {"h1", "oneliner", "methodology", "killchain"}

    def test_hackerone_alias_resolves_to_h1(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: dict[str, object] = {}

        def _fake_h1(**kw: object) -> list[object]:
            seen.update(kw)
            return []

        monkeypatch.setattr(S, "h1_search_corpus", _fake_h1)
        result = json.loads(
            search_security_references.invoke({"query": "ssrf", "kinds": ["hackerone"]})
        )
        assert result["kinds"] == ["h1"]
        assert result["results"]["h1"]["source"] == "hackerone-reports"
        assert seen["keyword"] == "ssrf"

    def test_h1_hits_sanitized_and_enveloped(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from raptix.execution.tools.references.h1_corpus import BugReport

        fake = BugReport(title="evil\x07title", bounty=9000.0)
        monkeypatch.setattr(S, "h1_search_corpus", lambda **kw: [fake])
        result = json.loads(search_security_references.invoke({"query": "ssrf", "kinds": ["h1"]}))
        data = result["results"]["h1"]["data"]
        assert data["reports"][0]["title"] == "eviltitle"

    def test_limit_clamped_to_twenty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: dict[str, object] = {}

        def _fake_h1(**kw: object) -> list[object]:
            seen.update(kw)
            return []

        monkeypatch.setattr(S, "h1_search_corpus", _fake_h1)
        search_security_references.invoke({"query": "ssrf", "kinds": ["h1"], "limit": 999})
        assert seen["limit"] == 20


class TestLookupPayload:
    def test_empty_args_rejected_with_hint(self) -> None:
        result = json.loads(lookup_payload.invoke({}))
        assert "error" in result
        assert "query and/or vuln_class" in result["error"]
        assert "imds" in result["hint"]

    def test_merged_search_hit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from raptix.execution.tools.references.payloads import PayloadBundle

        fake = PayloadBundle(
            vuln_class="ssrf", title="SSRF basic", payload="http://169.254.169.254/"
        )
        monkeypatch.setattr(S, "search_merged", lambda **kw: [fake])
        result = json.loads(lookup_payload.invoke({"query": "imds", "vuln_class": "ssrf"}))
        assert result["count"] == 1
        assert result["payloads"][0]["vuln_class"] == "ssrf"

    def test_falls_back_to_curated_when_merged_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from raptix.execution.tools.references.payloads import PayloadBundle

        fake = PayloadBundle(vuln_class="sqli", title="Classic OR 1=1", payload="' OR '1'='1")
        monkeypatch.setattr(S, "search_merged", lambda **kw: [])
        monkeypatch.setattr(S, "search_payloads", lambda **kw: [fake])
        result = json.loads(lookup_payload.invoke({"query": "auth bypass"}))
        assert result["count"] == 1
        assert result["payloads"][0]["vuln_class"] == "sqli"

    def test_bundled_library_searchable(self) -> None:
        result = json.loads(lookup_payload.invoke({"vuln_class": "ssrf"}))
        assert result["count"] > 0
        assert all(p["vuln_class"] == "ssrf" for p in result["payloads"])
