"""Extended tests for raptix.execution.tools.defense â€” push functions, edge cases.

Coverage additions on top of test_defense.py (which handles the basic converter
happy paths and minimal conops tests).  This file focuses on:
  - HTTP push functions (mocked requests) for splunk, elastic, sentinel, edr
  - All severity-map paths
  - Converter integration behavior: our pipeline-selection logic and
    exception-type wrapping around pySigma (condition-DSL coverage itself is
    pySigma's own test suite's job, not ours to re-verify)
  - ConOps helpers: list_targets, engagement_slug, _load_conops, invalid JSON
  - EDR: push_defender_xdr_detection and push_crowdstrike_ioa (full mock)
  - Error branches: missing URL/auth, HTTP 4xx, network exception
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from raptix_defense import conops as conops_mod

from raptix.execution.tools.defense.edr import (
    _CROWDSTRIKE_TYPE_MAP,
    _extract_yara_metadata,
    push_crowdstrike_ioa,
    push_defender_xdr_detection,
)
from raptix.execution.tools.defense.elastic import (
    SigmaToElasticError,
    push_detection_rule,
    sigma_to_lucene,
)
from raptix.execution.tools.defense.sentinel import (
    SigmaToKqlError,
    push_analytic_rule,
    sigma_to_kql,
)
from raptix.execution.tools.defense.splunk import (
    SigmaConversionError,
    push_savedsearch,
    sigma_to_spl,
)

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Helpers / fixtures
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def _conops_with(tmp_path: Path, blue_team: dict[str, Any]) -> Path:
    """Write a minimal conops.json in tmp_path and return the workspace path."""
    (tmp_path / "conops.json").write_text(
        json.dumps({"engagement_name": "test-eng", "blue_team": blue_team}),
        encoding="utf-8",
    )
    return tmp_path


def _mock_response(status_code: int = 200, text: str = "{}") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text
    return resp


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# conops helpers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestConOpsHelpers:
    def test_load_conops_invalid_json(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        (tmp_path / "conops.json").write_text("{ not valid json }", encoding="utf-8")
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        with pytest.raises(conops_mod.ConOpsLookupError, match="not valid JSON"):
            conops_mod._load_conops()

    def test_load_conops_finds_alternate_filenames(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        (tmp_path / "ConOps.json").write_text(
            json.dumps({"blue_team": {"splunk": {}}}), encoding="utf-8"
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        data = conops_mod._load_conops()
        assert "blue_team" in data

    def test_list_targets_returns_sorted_keys(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        _conops_with(tmp_path, {"splunk": {}, "elastic": {}, "sentinel": {}})
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        targets = conops_mod.list_targets()
        assert targets == sorted(["splunk", "elastic", "sentinel"])

    def test_list_targets_empty_when_no_conops(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        assert conops_mod.list_targets() == []

    def test_list_targets_empty_when_no_blue_team(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        (tmp_path / "conops.json").write_text(json.dumps({}), encoding="utf-8")
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        assert conops_mod.list_targets() == []

    def test_engagement_slug_uses_env_var(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_SLUG", "my-slug")
        assert conops_mod.engagement_slug() == "my-slug"

    def test_engagement_slug_from_conops(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("RAPTIX_ENGAGEMENT_SLUG", raising=False)
        (tmp_path / "conops.json").write_text(
            json.dumps({"engagement_name": "Red Team Alpha", "blue_team": {}}),
            encoding="utf-8",
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        assert conops_mod.engagement_slug() == "red-team-alpha"

    def test_engagement_slug_falls_back_to_unscoped(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.delenv("RAPTIX_ENGAGEMENT_SLUG", raising=False)
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        assert conops_mod.engagement_slug() == "unscoped"

    def test_resolve_auth_value_malformed_spec_raises(self, monkeypatch: pytest.MonkeyPatch):
        with pytest.raises(conops_mod.ConOpsLookupError, match="malformed"):
            conops_mod.resolve_auth_value("no-colon-here")

    def test_resolve_siem_target_no_blue_team_raises(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        (tmp_path / "conops.json").write_text(
            json.dumps({"engagement_name": "x"}), encoding="utf-8"
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        with pytest.raises(conops_mod.ConOpsLookupError, match="no ``blue_team``"):
            conops_mod.resolve_siem_target("elastic")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Splunk converter edge cases
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestSplunkConverter:
    def test_sigma_to_spl_malformed_rule_raises_our_exception_type(self):
        # pySigma's own SigmaError must surface as our SigmaConversionError,
        # not leak as a raw sigma.exceptions type — that's the integration
        # contract callers (the @tool wrapper) rely on.
        with pytest.raises(SigmaConversionError):
            sigma_to_spl({})

    def test_sigma_to_spl_and_condition(self):
        rule = {
            "title": "t",
            "logsource": {"product": "test"},
            "detection": {
                "selA": {"a": "1"},
                "selB": {"b": "2"},
                "condition": "selA and selB",
            },
        }
        spl = sigma_to_spl(rule)
        assert "a=" in spl and "b=" in spl

    def test_sigma_to_spl_not_condition(self):
        rule = {
            "title": "t",
            "logsource": {"product": "test"},
            "detection": {
                "sel": {"a": "1"},
                "condition": "not sel",
            },
        }
        spl = sigma_to_spl(rule)
        assert "NOT" in spl

    def test_sigma_to_spl_or_condition(self):
        rule = {
            "title": "t",
            "logsource": {"product": "test"},
            "detection": {
                "selA": {"a": "1"},
                "selB": {"b": "2"},
                "condition": "(selA or selB)",
            },
        }
        spl = sigma_to_spl(rule)
        assert "OR" in spl


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Sentinel / KQL converter edge cases
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestSentinelConverter:
    def test_sigma_to_kql_malformed_rule_raises_our_exception_type(self):
        with pytest.raises(SigmaToKqlError):
            sigma_to_kql({})

    def test_sigma_to_kql_unknown_token_raises(self):
        rule = {
            "title": "t",
            "logsource": {"product": "windows", "category": "process_creation"},
            "detection": {"sel": {"a": "1"}, "condition": "sel xor bad"},
        }
        with pytest.raises(SigmaToKqlError):
            sigma_to_kql(rule)

    def test_sigma_to_kql_and_or_not_parens_resolve_to_the_real_asim_table(self):
        # Pins the integration we actually care about: windows/process_creation
        # resolves to the real ASIM table (imProcessCreate), not a generic
        # "SecurityEvent" placeholder the hand-rolled predecessor used.
        rule = {
            "title": "t",
            "logsource": {"product": "windows", "category": "process_creation"},
            "detection": {
                "selA": {"Image|endswith": ".exe"},
                "selB": {"ParentImage|contains": "cmd"},
                "condition": "(selA and selB) or not selA",
            },
        }
        kql = sigma_to_kql(rule)
        assert kql.startswith("imProcessCreate")
        assert "and" in kql
        assert "or" in kql
        assert "not" in kql

    def test_sigma_to_kql_escapes_double_quote(self):
        rule = {
            "title": "t",
            "logsource": {"product": "windows", "category": "process_creation"},
            "detection": {
                "sel": {"CommandLine|contains": 'he said "hi"'},
                "condition": "sel",
            },
        }
        kql = sigma_to_kql(rule)
        assert '\\"hi\\"' in kql

    def test_severity_map_critical_maps_to_high(self):
        from raptix.execution.tools.defense.sentinel import _SEVERITY_MAP

        assert _SEVERITY_MAP["critical"] == "High"
        assert _SEVERITY_MAP["informational"] == "Informational"


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Elastic / Lucene converter edge cases
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestElasticConverter:
    def test_sigma_to_lucene_malformed_rule_raises_our_exception_type(self):
        with pytest.raises(SigmaToElasticError):
            sigma_to_lucene({})

    def test_sigma_to_lucene_and_or_not(self):
        rule = {
            "title": "t",
            "logsource": {"product": "test"},
            "detection": {
                "selA": {"Image|endswith": ".exe"},
                "selB": {"ParentImage|contains": "cmd"},
                "condition": "selA and selB",
            },
        }
        lucene = sigma_to_lucene(rule)
        assert "AND" in lucene
        assert "*.exe" in lucene

    def test_sigma_to_lucene_escapes_double_quote(self):
        rule = {
            "title": "t",
            "logsource": {"product": "test"},
            "detection": {
                "sel": {"CommandLine|contains": 'with "quotes"'},
                "condition": "sel",
            },
        }
        lucene = sigma_to_lucene(rule)
        assert '\\"quotes\\"' in lucene

    def test_severity_map_informational_is_low(self):
        from raptix.execution.tools.defense.elastic import _SEVERITY_MAP

        assert _SEVERITY_MAP["informational"] == "low"
        assert _SEVERITY_MAP["critical"] == "critical"


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# EDR helper: _extract_yara_metadata edge cases
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestExtractYaraMetadata:
    def test_tags_field_extracted(self):
        yara = """
        rule foo {
          meta:
            tags = "apt,lateral"
          condition: true
        }
        """
        meta = _extract_yara_metadata(yara)
        assert meta["tags"] == "apt,lateral"

    def test_empty_meta_block(self):
        yara = "rule x { meta: condition: true }"
        # no key-value pairs â€” returns empty dict
        assert _extract_yara_metadata(yara) == {}

    def test_crowdstrike_type_map_completeness(self):
        # Confirm all expected keys resolve to non-empty strings
        for key, val in _CROWDSTRIKE_TYPE_MAP.items():
            assert isinstance(val, str) and val


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# push_savedsearch â€” mocked HTTP
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestPushSavedsearch:
    def _setup_conops(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(
            tmp_path,
            {"splunk": {"url": "https://splunk.example", "auth": "hec_token:SPLUNK_TOKEN"}},
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("SPLUNK_TOKEN", "tok123")
        monkeypatch.delenv("RAPTIX_ENGAGEMENT_SLUG", raising=False)

    def test_success_200(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            result = push_savedsearch(
                "test-search",
                "index=main | stats count",
                description="desc",
                technique_id="T1059",
                severity="high",
            )
        assert result["status"] == "pushed"
        assert "test-search" in result["splunk_savedsearch_name"]
        assert result["severity"] == "high"
        assert result["technique_id"] == "T1059"
        mock_post.assert_called_once()
        call_kwargs = mock_post.call_args
        assert "services/saved/searches" in call_kwargs[0][0]

    def test_http_4xx_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(401, "Unauthorized"),
        ):
            result = push_savedsearch("search", "* | stats count")
        assert "error" in result
        assert "401" in result["error"]

    def test_network_exception_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            side_effect=ConnectionError("timeout"),
        ):
            result = push_savedsearch("s", "* | head 1")
        assert "error" in result
        assert "Splunk POST failed" in result["error"]

    def test_missing_conops_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        result = push_savedsearch("s", "* | head 1")
        assert "error" in result

    def test_missing_url_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(tmp_path, {"splunk": {"auth": "hec_token:SPLUNK_TOKEN"}})
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("SPLUNK_TOKEN", "tok")
        result = push_savedsearch("s", "* | head 1")
        assert "error" in result
        assert "missing" in result["error"]

    def test_missing_auth_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(tmp_path, {"splunk": {"url": "https://splunk.example"}})
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        result = push_savedsearch("s", "* | head 1")
        assert "error" in result

    def test_unresolvable_auth_env_returns_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        _conops_with(
            tmp_path,
            {"splunk": {"url": "https://splunk.example", "auth": "hec_token:MISSING_VAR"}},
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.delenv("MISSING_VAR", raising=False)
        result = push_savedsearch("s", "* | head 1")
        assert "error" in result

    def test_payload_contains_technique_id(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            push_savedsearch("s", "* | head 1", technique_id="T1003")
        data = mock_post.call_args[1]["data"]
        assert "T1003" in data["description"]

    def test_payload_no_technique_id(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            push_savedsearch("s", "* | head 1")
        data = mock_post.call_args[1]["data"]
        assert "MITRE" not in data["description"]


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# push_detection_rule (Elastic) â€” mocked HTTP
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestPushDetectionRule:
    def _setup_conops(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(
            tmp_path,
            {
                "elastic": {
                    "url": "https://kibana.example",
                    "auth": "api_key:ELASTIC_KEY",
                }
            },
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("ELASTIC_KEY", "apikey123")
        monkeypatch.delenv("RAPTIX_ENGAGEMENT_SLUG", raising=False)

    def test_success_200(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            result = push_detection_rule(
                "rule-001",
                "Test Rule",
                "process.name: powershell.exe",
                description="desc",
                severity="high",
                technique_id="T1059",
            )
        assert result["status"] == "pushed"
        assert "rule-001" in result["rule_id"]
        assert result["technique_id"] == "T1059"
        mock_post.assert_called_once()

    def test_409_triggers_put(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        """On HTTP 409 conflict, Elastic module retries with PUT."""
        self._setup_conops(tmp_path, monkeypatch)
        post_resp = _mock_response(409, "conflict")
        put_resp = _mock_response(200)
        with (
            patch(
                "requests.post",
                return_value=post_resp,
            ),
            patch(
                "requests.put",
                return_value=put_resp,
            ) as mock_put,
        ):
            result = push_detection_rule("r", "R", "query")
        assert result["status"] == "pushed"
        mock_put.assert_called_once()

    def test_4xx_after_put_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with (
            patch(
                "requests.post",
                return_value=_mock_response(409, "conflict"),
            ),
            patch(
                "requests.put",
                return_value=_mock_response(500, "server error"),
            ),
        ):
            result = push_detection_rule("r", "R", "query")
        assert "error" in result
        assert "500" in result["error"]

    def test_network_exception_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            side_effect=ConnectionError("network down"),
        ):
            result = push_detection_rule("r", "R", "query")
        assert "error" in result
        assert "Elastic POST failed" in result["error"]

    def test_put_network_exception_returns_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        self._setup_conops(tmp_path, monkeypatch)
        with (
            patch(
                "requests.post",
                return_value=_mock_response(409),
            ),
            patch(
                "requests.put",
                side_effect=ConnectionError("network down"),
            ),
        ):
            result = push_detection_rule("r", "R", "query")
        assert "error" in result
        assert "PUT" in result["error"]

    def test_custom_index_patterns(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            push_detection_rule("r", "R", "query", index_patterns=["custom-*", "special-*"])
        body = json.loads(mock_post.call_args[1]["data"])
        assert body["index"] == ["custom-*", "special-*"]

    def test_default_index_patterns(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            push_detection_rule("r", "R", "query")
        body = json.loads(mock_post.call_args[1]["data"])
        assert "logs-*" in body["index"]

    def test_missing_conops_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        result = push_detection_rule("r", "R", "query")
        assert "error" in result

    def test_severity_normalised(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            push_detection_rule("r", "R", "query", severity="informational")
        body = json.loads(mock_post.call_args[1]["data"])
        assert body["severity"] == "low"


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# push_analytic_rule (Sentinel) â€” mocked HTTP
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestPushAnalyticRule:
    def _setup_conops(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(
            tmp_path,
            {
                "sentinel": {
                    "subscription_id": "sub-1",
                    "resource_group": "rg-1",
                    "workspace_name": "ws-1",
                    "auth": "oauth:AZURE_TOKEN",
                }
            },
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("AZURE_TOKEN", "bearer-xyz")
        monkeypatch.delenv("RAPTIX_ENGAGEMENT_SLUG", raising=False)

    def test_success_200(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.put",
            return_value=_mock_response(200),
        ) as mock_put:
            result = push_analytic_rule(
                "rule-1",
                "My Rule",
                "SecurityEvent | where EventID == 4625",
                severity="high",
                technique_id="T1078",
            )
        assert result["status"] == "pushed"
        assert result["technique_id"] == "T1078"
        mock_put.assert_called_once()

    def test_technique_id_in_body_properties(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.put",
            return_value=_mock_response(200),
        ) as mock_put:
            push_analytic_rule("r", "R", "query", technique_id="T1234")
        body = json.loads(mock_put.call_args[1]["data"])
        assert body["properties"]["techniques"] == ["T1234"]

    def test_no_technique_id_omits_techniques_key(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.put",
            return_value=_mock_response(200),
        ) as mock_put:
            push_analytic_rule("r", "R", "query")
        body = json.loads(mock_put.call_args[1]["data"])
        assert "techniques" not in body["properties"]

    def test_severity_critical_maps_to_high(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.put",
            return_value=_mock_response(200),
        ) as mock_put:
            push_analytic_rule("r", "R", "query", severity="critical")
        body = json.loads(mock_put.call_args[1]["data"])
        assert body["properties"]["severity"] == "High"

    def test_http_4xx_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.put",
            return_value=_mock_response(403, "Forbidden"),
        ):
            result = push_analytic_rule("r", "R", "query")
        assert "error" in result
        assert "403" in result["error"]

    def test_network_exception_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.put",
            side_effect=ConnectionError("unreachable"),
        ):
            result = push_analytic_rule("r", "R", "query")
        assert "error" in result
        assert "Sentinel PUT failed" in result["error"]

    def test_missing_conops_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        result = push_analytic_rule("r", "R", "query")
        assert "error" in result

    def test_incomplete_sentinel_config_returns_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        # Missing workspace_name
        _conops_with(
            tmp_path,
            {
                "sentinel": {
                    "subscription_id": "sub-1",
                    "resource_group": "rg-1",
                    "auth": "oauth:AZURE_TOKEN",
                }
            },
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("AZURE_TOKEN", "tok")
        result = push_analytic_rule("r", "R", "query")
        assert "error" in result
        assert "subscription_id" in result["error"] or "workspace_name" in result["error"]

    def test_url_contains_subscription_and_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.put",
            return_value=_mock_response(200),
        ) as mock_put:
            push_analytic_rule("r", "R", "query")
        url = mock_put.call_args[0][0]
        assert "sub-1" in url
        assert "rg-1" in url
        assert "ws-1" in url


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# push_defender_xdr_detection â€” mocked HTTP
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestPushDefenderXdr:
    def _setup_conops(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(
            tmp_path,
            {"defender": {"auth": "oauth:DEFENDER_TOKEN"}},
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("DEFENDER_TOKEN", "def-bearer")
        monkeypatch.delenv("RAPTIX_ENGAGEMENT_SLUG", raising=False)

    _YARA_WITH_TAGS = """
    rule MyRule {
      meta:
        tags = "apt29,lateral-movement"
        sha256 = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
      strings:
        $a = "malware"
      condition:
        $a
    }
    """

    def test_success_200(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            result = push_defender_xdr_detection(
                "test-rule",
                self._YARA_WITH_TAGS,
                description="desc",
                severity="high",
                technique_id="T1059",
            )
        assert result["status"] == "pushed"
        assert "test-rule" in result["rule_id"]
        assert result["technique_id"] == "T1059"
        mock_post.assert_called_once()

    def test_tags_from_yara_meta_included(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            push_defender_xdr_detection("r", self._YARA_WITH_TAGS)
        body = json.loads(mock_post.call_args[1]["data"])
        # tags from YARA meta are split and appended
        assert "apt29" in body["tags"] or any("apt29" in t for t in body["tags"])

    def test_technique_id_in_tags(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            push_defender_xdr_detection("r", self._YARA_WITH_TAGS, technique_id="T1003")
        body = json.loads(mock_post.call_args[1]["data"])
        assert "T1003" in body["tags"]

    def test_http_4xx_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(400, "bad request"),
        ):
            result = push_defender_xdr_detection("r", self._YARA_WITH_TAGS)
        assert "error" in result
        assert "400" in result["error"]

    def test_network_exception_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            side_effect=ConnectionError("timeout"),
        ):
            result = push_defender_xdr_detection("r", self._YARA_WITH_TAGS)
        assert "error" in result
        assert "Defender POST failed" in result["error"]

    def test_missing_auth_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(tmp_path, {"defender": {}})
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        result = push_defender_xdr_detection("r", self._YARA_WITH_TAGS)
        assert "error" in result
        assert "missing ``auth``" in result["error"]

    def test_missing_conops_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        result = push_defender_xdr_detection("r", self._YARA_WITH_TAGS)
        assert "error" in result


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# push_crowdstrike_ioa â€” mocked HTTP
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class TestPushCrowdstrikeIoa:
    _YARA_FULL = """
    rule CsRule {
      meta:
        indicator_type = "sha256"
        indicator_value = "abcd1234"
      condition: true
    }
    """

    def _setup_conops(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(
            tmp_path,
            {
                "crowdstrike": {
                    "url": "https://api.crowdstrike.example",
                    "auth": "oauth:CS_TOKEN",
                }
            },
        )
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("CS_TOKEN", "cs-bearer")
        monkeypatch.delenv("RAPTIX_ENGAGEMENT_SLUG", raising=False)

    def test_success_200(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ) as mock_post:
            result = push_crowdstrike_ioa(
                self._YARA_FULL,
                description="desc",
                severity="high",
                technique_id="T1003",
            )
        assert result["status"] == "pushed"
        assert result["indicator_type"] == "sha256"
        assert result["indicator_value"] == "abcd1234"
        mock_post.assert_called_once()
        url = mock_post.call_args[0][0]
        assert "iocs/entities/indicators/v1" in url

    def test_missing_indicator_type_returns_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        self._setup_conops(tmp_path, monkeypatch)
        yara_no_type = """
        rule X {
          meta:
            indicator_value = "abc"
          condition: true
        }
        """
        result = push_crowdstrike_ioa(yara_no_type)
        assert "error" in result
        assert "indicator_type" in result["error"]

    def test_missing_indicator_value_returns_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        self._setup_conops(tmp_path, monkeypatch)
        yara_no_value = """
        rule X {
          meta:
            indicator_type = "sha256"
          condition: true
        }
        """
        result = push_crowdstrike_ioa(yara_no_value)
        assert "error" in result
        assert "indicator_value" in result["error"]

    def test_unsupported_indicator_type_returns_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        self._setup_conops(tmp_path, monkeypatch)
        yara_bad_type = """
        rule X {
          meta:
            indicator_type = "yara_bytes"
            indicator_value = "abc"
          condition: true
        }
        """
        result = push_crowdstrike_ioa(yara_bad_type)
        assert "error" in result
        assert "yara_bytes" in result["error"]

    def test_http_4xx_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            return_value=_mock_response(429, "rate limited"),
        ):
            result = push_crowdstrike_ioa(self._YARA_FULL)
        assert "error" in result
        assert "429" in result["error"]

    def test_network_exception_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        self._setup_conops(tmp_path, monkeypatch)
        with patch(
            "requests.post",
            side_effect=ConnectionError("unreachable"),
        ):
            result = push_crowdstrike_ioa(self._YARA_FULL)
        assert "error" in result
        assert "CrowdStrike POST failed" in result["error"]

    def test_missing_conops_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        result = push_crowdstrike_ioa(self._YARA_FULL)
        assert "error" in result

    def test_missing_url_returns_error(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        _conops_with(tmp_path, {"crowdstrike": {"auth": "oauth:CS_TOKEN"}})
        monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
        monkeypatch.setenv("CS_TOKEN", "tok")
        result = push_crowdstrike_ioa(self._YARA_FULL)
        assert "error" in result

    def test_ioc_fallback_key_for_value(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        """``ioc`` key in meta is accepted as indicator_value fallback."""
        self._setup_conops(tmp_path, monkeypatch)
        yara_ioc_key = """
        rule X {
          meta:
            indicator_type = "domain"
            ioc = "evil.example.com"
          condition: true
        }
        """
        with patch(
            "requests.post",
            return_value=_mock_response(200),
        ):
            result = push_crowdstrike_ioa(yara_ioc_key)
        assert result["status"] == "pushed"
        assert result["indicator_value"] == "evil.example.com"

    def test_all_crowdstrike_mapped_types_accepted(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        """Every key in _CROWDSTRIKE_TYPE_MAP produces a successful push."""
        self._setup_conops(tmp_path, monkeypatch)
        for raw_type in _CROWDSTRIKE_TYPE_MAP:
            yara = f"""
            rule X {{
              meta:
                indicator_type = "{raw_type}"
                indicator_value = "test-value"
              condition: true
            }}
            """
            with patch(
                "requests.post",
                return_value=_mock_response(200),
            ):
                result = push_crowdstrike_ioa(yara)
            assert result.get("status") == "pushed", (
                f"Expected pushed for type={raw_type!r}, got {result!r}"
            )
