"""Tests for raptix.execution.tools.defense."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from raptix_defense import conops as conops_mod

from raptix.execution.tools.defense.edr import _extract_yara_metadata, push_defender_xdr_detection
from raptix.execution.tools.defense.elastic import (
    SigmaToElasticError,
    sigma_to_lucene,
)
from raptix.execution.tools.defense.sentinel import (
    SigmaToKqlError,
    sigma_to_kql,
)
from raptix.execution.tools.defense.splunk import (
    SigmaConversionError,
    sigma_to_spl,
)


def _basic_sigma() -> dict:
    return {
        "title": "test-rule",
        "logsource": {"product": "windows", "category": "process_creation"},
        "detection": {
            "selection": {
                "Image|endswith": "\\powershell.exe",
                "CommandLine|contains": "DownloadString",
            },
            "condition": "selection",
        },
    }


def test_sigma_to_spl_basic():
    # No logsource-specific Splunk pipeline renames these two fields (CIM
    # already uses Image/CommandLine for this category), so they pass
    # through unchanged — still routed through the real pySigma engine.
    spl = sigma_to_spl(_basic_sigma())
    assert 'Image="*\\\\powershell.exe"' in spl
    assert 'CommandLine="*DownloadString*"' in spl


def test_sigma_to_spl_with_or_condition():
    rule = {
        "title": "or-rule",
        "logsource": {"product": "test"},
        "detection": {
            "selA": {"a": "1"},
            "selB": {"b": "2"},
            "condition": "selA or selB",
        },
    }
    spl = sigma_to_spl(rule)
    assert "OR" in spl
    assert "a=" in spl and "b=" in spl


def test_sigma_to_spl_with_list_value():
    # pySigma renders a multi-value field|endswith selection as one IN(...)
    # clause rather than the old hand-rolled repeated-OR-clause form.
    rule = {
        "title": "list-rule",
        "logsource": {"product": "test"},
        "detection": {
            "sel": {"Image|endswith": ["\\cmd.exe", "\\powershell.exe"]},
            "condition": "sel",
        },
    }
    spl = sigma_to_spl(rule)
    assert "Image IN" in spl
    assert "*\\\\cmd.exe" in spl
    assert "*\\\\powershell.exe" in spl


def test_sigma_to_spl_unknown_modifier_raises():
    rule = {
        "title": "t",
        "logsource": {"product": "test"},
        "detection": {
            "sel": {"field|exotic_modifier": "x"},
            "condition": "sel",
        },
    }
    with pytest.raises(SigmaConversionError):
        sigma_to_spl(rule)


def test_sigma_to_spl_unknown_selection_raises():
    rule = {
        "title": "t",
        "logsource": {"product": "test"},
        "detection": {
            "selA": {"a": "1"},
            "condition": "missing_selection",
        },
    }
    with pytest.raises(SigmaConversionError):
        sigma_to_spl(rule)


def test_sigma_to_kql_maps_to_the_real_asim_table_and_fields():
    # The ASIM pipeline resolves windows/process_creation to the real
    # normalized table (imProcessCreate) and maps Image/CommandLine to
    # their ASIM field names — the hand-rolled predecessor sent every
    # Windows rule to a generic "SecurityEvent" table with unmapped fields,
    # which parses but matches nothing against a real ASIM workspace.
    kql = sigma_to_kql(_basic_sigma())
    assert kql.startswith("imProcessCreate")
    assert "TargetProcessName" in kql
    assert "TargetProcessCommandLine" in kql


def test_sigma_to_kql_unknown_modifier_raises():
    rule = {
        "title": "t",
        "logsource": {"product": "windows", "category": "process_creation"},
        "detection": {
            "sel": {"field|nope": "x"},
            "condition": "sel",
        },
    }
    with pytest.raises(SigmaToKqlError):
        sigma_to_kql(rule)


def test_sigma_to_lucene_basic():
    # ECS maps Image -> process.executable.caseless and CommandLine ->
    # process.command_line for a real Elastic cluster; the hand-rolled
    # predecessor emitted the raw Sigma field names unmapped.
    lucene = sigma_to_lucene(_basic_sigma())
    assert "process.executable.caseless:*\\\\powershell.exe" in lucene
    assert "process.command_line:*DownloadString*" in lucene


def test_sigma_to_lucene_unknown_token_raises():
    rule = {
        "title": "t",
        "logsource": {"product": "test"},
        "detection": {
            "sel": {"a": "1"},
            "condition": "sel xor what",
        },
    }
    with pytest.raises(SigmaToElasticError):
        sigma_to_lucene(rule)


def test_extract_yara_metadata_pulls_meta_kvs():
    yara = """
    rule foo {
      meta:
        author = "decepticon"
        indicator_type = "sha256"
        indicator_value = "deadbeef"
      strings:
        $a = "x"
      condition:
        $a
    }
    """
    meta = _extract_yara_metadata(yara)
    assert meta["author"] == "decepticon"
    assert meta["indicator_type"] == "sha256"
    assert meta["indicator_value"] == "deadbeef"


def test_extract_yara_metadata_empty_when_no_meta_block():
    yara = 'rule bar { strings: $a = "x" condition: $a }'
    assert _extract_yara_metadata(yara) == {}


def test_resolve_siem_target_missing_conops_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
    with pytest.raises(conops_mod.ConOpsLookupError):
        conops_mod.resolve_siem_target("splunk")


def test_resolve_siem_target_missing_target_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "conops.json").write_text(json.dumps({"blue_team": {}}))
    monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
    with pytest.raises(conops_mod.ConOpsLookupError):
        conops_mod.resolve_siem_target("splunk")


def test_resolve_siem_target_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "conops.json").write_text(
        json.dumps(
            {
                "blue_team": {
                    "splunk": {"url": "https://splunk.example", "auth": "hec_token:HEC_TOKEN"}
                }
            }
        )
    )
    monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
    target = conops_mod.resolve_siem_target("splunk")
    assert target["url"] == "https://splunk.example"


def test_resolve_auth_value_missing_env_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("NOT_SET_AT_ALL", raising=False)
    with pytest.raises(conops_mod.ConOpsLookupError):
        conops_mod.resolve_auth_value("hec_token:NOT_SET_AT_ALL")


def test_resolve_auth_value_success(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SOME_TOKEN", "supersecret")
    assert conops_mod.resolve_auth_value("hec_token:SOME_TOKEN") == "supersecret"


def test_sigma_to_spl_contains_with_spaces_stays_quoted():
    rule = {
        "title": "t",
        "logsource": {"product": "test"},
        "detection": {
            "sel": {"CommandLine|contains": "cmd.exe /c whoami"},
            "condition": "sel",
        },
    }
    spl = sigma_to_spl(rule)
    assert 'CommandLine="*cmd.exe /c whoami*"' in spl


def test_sigma_to_spl_contains_with_special_chars_escaped():
    rule = {
        "title": "t",
        "logsource": {"product": "test"},
        "detection": {
            "sel": {"CommandLine|contains": 'say "hello" and\\or'},
            "condition": "sel",
        },
    }
    spl = sigma_to_spl(rule)
    assert 'CommandLine="*say \\"hello\\" and\\\\or*"' in spl


def _yara_with_sha256(sha256: str) -> str:
    return f"""
    rule test_rule {{
      meta:
        sha256 = "{sha256}"
      strings:
        $a = "malware"
      condition:
        $a
    }}
    """


def _yara_no_indicator() -> str:
    return """
    rule test_rule {
      meta:
        author = "tester"
      strings:
        $a = "malware"
      condition:
        $a
    }
    """


def test_push_defender_xdr_kql_built_from_sha256(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    sha = "abc123def456" * 4 + "abcd"
    yara = _yara_with_sha256(sha)

    (tmp_path / "conops.json").write_text(
        json.dumps(
            {
                "blue_team": {"defender": {"auth": "bearer_token:DEFENDER_TOKEN"}},
                "engagement": {"slug": "test-eng"},
            }
        )
    )
    monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("DEFENDER_TOKEN", "fake-token")

    mock_resp = MagicMock()
    mock_resp.status_code = 201
    mock_resp.text = "{}"

    with patch("requests.post", return_value=mock_resp) as mock_post:
        result = push_defender_xdr_detection("test-rule", yara)

    assert result.get("status") == "pushed"
    posted_body = json.loads(mock_post.call_args.kwargs.get("data", "{}"))
    query_text = posted_body["queryCondition"]["queryText"]
    assert "DeviceFileEvents" in query_text
    assert "where SHA256 ==" in query_text
    assert sha in query_text
    assert "rule test_rule" not in query_text


def test_push_defender_xdr_no_indicator_returns_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    yara = _yara_no_indicator()

    (tmp_path / "conops.json").write_text(
        json.dumps(
            {
                "blue_team": {"defender": {"auth": "bearer_token:DEFENDER_TOKEN"}},
                "engagement": {"slug": "test-eng"},
            }
        )
    )
    monkeypatch.setenv("RAPTIX_ENGAGEMENT_WORKSPACE", str(tmp_path))
    monkeypatch.setenv("DEFENDER_TOKEN", "fake-token")

    with patch("requests.post") as mock_post:
        result = push_defender_xdr_detection("test-rule", yara)

    mock_post.assert_not_called()
    assert "error" in result
    assert "no extractable indicator" in result["error"]
