"""TC-3 tool-version manifest provenance — deterministic parsing tests."""

from __future__ import annotations

from raptix.capabilities.tool_versions import (
    build_tool_provenance,
    parse_tool_versions_tsv,
    provenance_for_tool,
    tool_version_from_manifest,
)

WEB_TSV = """\
# /opt/raptix/tool-versions/sandbox-web.tsv
httpx-toolkit\t1.7.0
katana\t1.1.2
ffuf\t2.1.0
nuclei\t3.3.9
testssl.sh\t3.2
nuclei-templates\tv9.8.2 (pinned corpus at /opt/raptix/nuclei-templates)
"""


class TestParseToolVersionsTsv:
    def test_parses_tool_version_pairs(self) -> None:
        versions = parse_tool_versions_tsv(WEB_TSV)
        assert versions["nuclei"] == "3.3.9"
        assert versions["httpx-toolkit"] == "1.7.0"
        assert versions["nuclei-templates"].startswith("v9.8.2")

    def test_blank_version_is_an_explicit_unknown_gap(self) -> None:
        versions = parse_tool_versions_tsv("mystery-tool\t\n")
        assert versions["mystery-tool"] == "unknown"

    def test_malformed_lines_are_recorded_not_dropped(self) -> None:
        versions = parse_tool_versions_tsv("no-tab-line\nok\t1.0\n")
        assert versions["ok"] == "1.0"
        assert versions["malformed:no-tab-line"] == "unknown"


class TestProvenanceBuilding:
    def test_merge_preserves_unknown_gaps(self) -> None:
        provenance = build_tool_provenance(
            {"sandbox-web": WEB_TSV, "sandbox-ad": "netexec\t1.3.0\n"}
        )
        assert provenance["profiles"]["sandbox-ad"] == {"netexec": "1.3.0"}
        assert provenance["profiles"]["sandbox-web"]["nuclei"] == "3.3.9"

    def test_tool_version_unknown_is_none_not_zero(self) -> None:
        versions = parse_tool_versions_tsv(WEB_TSV)
        assert tool_version_from_manifest(versions, "nuclei") == "3.3.9"
        assert tool_version_from_manifest(versions, "not-a-tool") is None
        assert tool_version_from_manifest({"gap": "unknown"}, "gap") is None

    def test_provenance_for_tool_omits_version_when_unknown(self) -> None:
        provenance = provenance_for_tool(
            tool_name="nuclei",
            manifest_contents={"sandbox-web": WEB_TSV},
            parser_version="2.0.0",
        )
        assert provenance == {
            "tool_name": "nuclei",
            "tool_version": "3.3.9",
            "parser_version": "2.0.0",
        }

        missing = provenance_for_tool(
            tool_name="not-a-tool",
            manifest_contents={"sandbox-web": WEB_TSV},
        )
        assert missing == {"tool_name": "not-a-tool"}
        assert "tool_version" not in missing
