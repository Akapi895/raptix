"""Unit tests for PoC validation.

CVSS scoring itself is covered by ``tests/unit/reporting/test_cvss.py`` —
``poc.py`` only delegates to ``reporting.cvss.score_vector``.
"""

from __future__ import annotations

import pytest

from raptix.execution.tools.research.poc import _match_signals, validate_poc
from raptix_core.types.kg import (
    KnowledgeGraph,
    Node,
    NodeKind,
)


class TestSignalMatching:
    def test_plain_string_match(self) -> None:
        assert _match_signals("uid=0(root)", ["uid=0", "root"]) == ["uid=0", "root"]

    def test_case_insensitive(self) -> None:
        assert _match_signals("ROOT", ["root"]) == ["root"]

    def test_regex_match(self) -> None:
        assert _match_signals("AccessKey: ABCDEFG", [r"AccessKey:\s+\w+"]) == [r"AccessKey:\s+\w+"]

    def test_no_match_returns_empty(self) -> None:
        assert _match_signals("nothing to see", ["pwned"]) == []

    def test_invalid_regex_falls_back_to_substring(self) -> None:
        # "[unclosed" is invalid regex — should still match as substring
        assert _match_signals("foo [unclosed bar", ["[unclosed"]) == ["[unclosed"]


class TestValidatePoc:
    @pytest.mark.asyncio
    async def test_happy_path_validates(self) -> None:
        async def runner(cmd: str) -> tuple[str, str, int]:
            return ("uid=0(root) gid=0(root)", "", 0)

        result = await validate_poc(
            vuln_id="vuln1",
            poc_command="id",
            success_patterns=["uid=0"],
            runner=runner,
        )
        assert result.validated is True
        assert "uid=0" in result.success_signals

    @pytest.mark.asyncio
    async def test_no_signal_fails(self) -> None:
        async def runner(cmd: str) -> tuple[str, str, int]:
            return ("nothing", "", 0)

        result = await validate_poc(
            vuln_id="vuln1",
            poc_command="id",
            success_patterns=["uid=0"],
            runner=runner,
        )
        assert result.validated is False

    @pytest.mark.asyncio
    async def test_negative_control_demotes(self) -> None:
        """If the baseline also matches the success pattern, we demote."""

        async def runner(cmd: str) -> tuple[str, str, int]:
            # BOTH payload and baseline return the same marker
            return ("marker found", "", 0)

        result = await validate_poc(
            vuln_id="vuln1",
            poc_command="curl /exploit",
            success_patterns=["marker"],
            runner=runner,
            negative_command="curl /baseline",
            negative_patterns=["marker"],
        )
        # Negative patterns matched → validated must be False
        assert result.validated is False

    @pytest.mark.asyncio
    async def test_cvss_attached_on_success(self) -> None:
        async def runner(cmd: str) -> tuple[str, str, int]:
            return ("pwned", "", 0)

        cvss = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
        result = await validate_poc(
            vuln_id="vuln1",
            poc_command="curl",
            success_patterns=["pwned"],
            runner=runner,
            cvss=cvss,
        )
        assert result.cvss is not None
        assert result.cvss_score == 9.8
        assert result.severity == "critical"

    @pytest.mark.asyncio
    async def test_persists_to_graph(self) -> None:
        g = KnowledgeGraph()
        vuln = g.upsert_node(Node.make(NodeKind.VULNERABILITY, "SSRF", severity="medium"))

        async def runner(cmd: str) -> tuple[str, str, int]:
            return ("root creds leaked AccessKeyId: ABCD", "", 0)

        cvss = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"
        result = await validate_poc(
            vuln_id=vuln.id,
            poc_command="curl /exploit",
            success_patterns=[r"AccessKeyId"],
            runner=runner,
            cvss=cvss,
            graph=g,
        )
        assert result.validated is True
        # Graph updated — validated flag set, severity upgraded
        updated = g.nodes[vuln.id]
        assert updated.props["validated"] is True
        assert updated.props["severity"] == "critical"
        assert updated.props["cvss_score"] == 10.0
        # Finding node created
        findings = g.by_kind(NodeKind.FINDING)
        assert len(findings) == 1
        assert findings[0].props["validated"] is True
