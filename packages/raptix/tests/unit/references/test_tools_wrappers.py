from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pytest

from raptix.execution.tools.references import tools as T
from raptix.execution.tools.references.catalog import REFERENCES, references_by_category
from raptix.execution.tools.references.corpus import (
    UNTRUSTED_HEADER,
    sanitize_corpus_text,
    wrap_corpus,
)
from raptix.execution.tools.references.hydrate import HydrationResult
from raptix.execution.tools.references.payloads import PayloadBundle


def _load(result: str) -> Any:
    data = json.loads(result)
    if isinstance(data, dict) and data.get("trust") == "untrusted-external-corpus":
        return data.get("data", {})
    return data


class TestSanitizeCorpusText:
    def test_empty_string_returns_empty_immediately(self) -> None:
        assert sanitize_corpus_text("") == ""

    def test_control_chars_stripped_but_whitespace_kept(self) -> None:
        result = sanitize_corpus_text("a\x00b\x07c\tdone\n")
        assert result == "abc\tdone\n"

    def test_truncation_branch_appends_suffix(self) -> None:
        result = sanitize_corpus_text("x" * 50, limit=10)
        assert result.startswith("x" * 10)
        assert result.endswith("…[truncated by corpus sanitiser]")


class TestWrapCorpus:
    def test_envelope_shape_and_values(self) -> None:
        result = wrap_corpus("src", {"k": 1})
        assert result["source"] == "src"
        assert result["trust"] == "untrusted-external-corpus"
        assert result["notice"] == UNTRUSTED_HEADER
        assert result["data"] == {"k": 1}


class TestRefList:
    def test_all_branch_returns_full_catalog(self) -> None:
        data = json.loads(T.ref_list())
        assert data["count"] == len(REFERENCES)
        assert data["count"] == len(data["references"])
        slugs = {r["slug"] for r in data["references"]}
        assert "hackerone-reports" in slugs

    def test_category_filter_branch_returns_subset(self) -> None:
        category = "report-corpus"
        expected = references_by_category(category)
        data = json.loads(T.ref_list(category))
        assert data["count"] == len(expected)
        assert all(r["category"] == category for r in data["references"])

    def test_nonexistent_category_returns_empty(self) -> None:
        data = json.loads(T.ref_list("nonexistent-cat"))
        assert data["count"] == 0
        assert data["references"] == []


class TestRefSuggest:
    def test_vuln_class_branch_returns_results(self) -> None:
        data = json.loads(T.ref_suggest(vuln_class="ssrf"))
        assert data["count"] > 0

    def test_goal_branch_returns_results(self) -> None:
        data = json.loads(T.ref_suggest(goal="recon"))
        assert data["count"] > 0


class TestRefTopic:
    def test_known_topic_returns_matching_entries(self) -> None:
        data = json.loads(T.ref_topic("ssrf"))
        assert data["topic"] == "ssrf"
        assert data["count"] >= 0

    def test_unknown_topic_returns_zero_count(self) -> None:
        data = json.loads(T.ref_topic("nonexistent-topic-xyz999"))
        assert data["count"] == 0
        assert data["references"] == []


@dataclass
class _FakeCacheStatus:
    slug: str
    present: bool
    size_bytes: int

    def to_dict(self) -> dict[str, Any]:
        return {"slug": self.slug, "present": self.present, "size_bytes": self.size_bytes}


class TestRefFetch:
    def test_success_branch_returns_status_dict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = _FakeCacheStatus(slug="hackerone-reports", present=True, size_bytes=123)
        monkeypatch.setattr(T, "ensure_cached", lambda slug: fake)
        data = json.loads(T.ref_fetch("hackerone-reports"))
        assert "error" not in data
        assert data["slug"] == "hackerone-reports"
        assert data["present"] is True

    def test_keyerror_branch_returns_error_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _raise(slug: str) -> _FakeCacheStatus:
            raise KeyError("unknown reference slug: bogus")

        monkeypatch.setattr(T, "ensure_cached", _raise)
        data = json.loads(T.ref_fetch("bogus"))
        assert "error" in data
        assert "unknown reference slug" in data["error"]


class TestRefStatus:
    def test_single_slug_success_branch(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: object
    ) -> None:
        monkeypatch.setenv("RAPTIX_REFERENCES_ROOT", str(tmp_path))
        fake = _FakeCacheStatus(slug="hackerone-reports", present=False, size_bytes=0)
        monkeypatch.setattr(T, "cache_status", lambda slug: fake)
        data = json.loads(T.ref_status("hackerone-reports"))
        assert "error" not in data
        assert data["slug"] == "hackerone-reports"
        assert data["present"] is False

    def test_single_slug_keyerror_branch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _raise(slug: str) -> _FakeCacheStatus:
            raise KeyError("unknown reference slug: bogus")

        monkeypatch.setattr(T, "cache_status", _raise)
        data = json.loads(T.ref_status("bogus"))
        assert "error" in data

    def test_full_map_branch_returns_all_slugs(self, monkeypatch: pytest.MonkeyPatch) -> None:
        call_count: list[str] = []

        def _fake_cache_status(slug: str) -> _FakeCacheStatus:
            call_count.append(slug)
            return _FakeCacheStatus(slug=slug, present=False, size_bytes=0)

        monkeypatch.setattr(T, "cache_status", _fake_cache_status)
        data = json.loads(T.ref_status())
        assert data["count"] == len(REFERENCES)
        assert all("slug" in row for row in data["cache"])
        assert len(call_count) == len(REFERENCES)


class TestRefGrep:
    def test_pattern_too_long_returns_error(self) -> None:
        data = json.loads(T.ref_grep("hackerone-reports", "a" * 201))
        assert data["ok"] is False
        assert data["error"] == "pattern too long (>200 chars)"

    def test_keyerror_branch_returns_ok_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def _raise(slug: str, pattern: str, **kwargs: Any) -> list[Any]:
            raise KeyError("unknown reference slug: bogus")

        monkeypatch.setattr(T, "search_cache", _raise)
        data = json.loads(T.ref_grep("bogus", "x"))
        assert data["ok"] is False
        assert "unknown reference slug" in data["error"]

    def test_success_branch_wraps_envelope_and_sanitizes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        raw_snip = "hit \x00line one" * 30
        monkeypatch.setattr(
            T, "search_cache", lambda slug, pattern, **kw: [("file.md", 7, raw_snip)]
        )
        outer = json.loads(T.ref_grep("hackerone-reports", "hit"))
        assert outer["trust"] == "untrusted-external-corpus"
        assert outer["source"] == "hackerone-reports"
        data = outer["data"]
        assert data["count"] == 1
        assert data["hits"][0]["file"] == "file.md"
        assert data["hits"][0]["line"] == 7
        snippet = data["hits"][0]["snippet"]
        assert "\x00" not in snippet
        assert len(snippet) <= 240 + len("\n\n…[truncated by corpus sanitiser]")


class TestPayloadSearchFallback:
    def test_fallback_branch_when_search_merged_returns_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_payload = PayloadBundle(
            vuln_class="ssrf",
            title="SSRF basic",
            payload="http://169.254.169.254/",
        )
        monkeypatch.setattr(T, "search_merged", lambda **kw: [])
        monkeypatch.setattr(T, "search_payloads", lambda **kw: [fake_payload])
        data = json.loads(T.payload_search(vuln_class="ssrf"))
        assert data["count"] == 1
        assert data["payloads"][0]["vuln_class"] == "ssrf"

    def test_no_fallback_when_search_merged_returns_results(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_payload = PayloadBundle(
            vuln_class="ssrf",
            title="SSRF merged",
            payload="http://169.254.169.254/",
        )

        sentinel_called: list[bool] = []

        def _guard(**kw: Any) -> list[Any]:
            sentinel_called.append(True)
            return []

        monkeypatch.setattr(T, "search_merged", lambda **kw: [fake_payload])
        monkeypatch.setattr(T, "search_payloads", _guard)
        data = json.loads(T.payload_search(keyword="imds"))
        assert data["count"] == 1
        assert not sentinel_called


class TestPayloadClassesBundledFallback:
    def test_bundled_fallback_when_merged_payloads_empty(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(T, "merged_payloads", lambda: [])
        data = json.loads(T.payload_classes())
        assert data["count"] > 0
        classes = {c["vuln_class"] for c in data["classes"]}
        assert "ssrf" in classes


class TestReferencesHydrate:
    def test_success_branch_returns_report_and_results(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake_result = HydrationResult(
            slug="hackerone-reports", ok=True, present=True, size_bytes=999
        )
        monkeypatch.setattr(T, "hydrate_all", lambda: [fake_result])
        monkeypatch.setattr(T, "format_report", lambda results: "REPORT")
        data = json.loads(T.references_hydrate())
        assert data["report"] == "REPORT"
        assert len(data["results"]) == 1
        assert data["results"][0]["slug"] == "hackerone-reports"


class TestH1SearchTitleSanitization:
    def test_control_char_in_title_stripped_in_envelope(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from raptix.execution.tools.references.h1_corpus import BugReport

        fake_report = BugReport(title="evil\x07title", bounty=100.0)
        monkeypatch.setattr(T, "h1_search_corpus", lambda **kw: [fake_report])
        outer = json.loads(T.h1_search(keyword="x"))
        data = outer["data"]
        assert data["reports"][0]["title"] == "eviltitle"
