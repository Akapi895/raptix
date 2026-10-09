"""Deterministic parsers for the T7 adapter output formats that previously
had no default parser (sqlmap/nikto/impacket/responder â€” plan TC-1).

Realistic captured-output fixtures (no network, no LLM): every parser
normalizes genuine versioned tool output into observations, and every
negative case (not-injectable, access-denied, truncation, analysis-only
capture) yields zero fabricated success.
"""

from __future__ import annotations

from typing import Any, Protocol, cast

import pytest
from pydantic import JsonValue

from raptix.knowledge.ingest import default_registry as _default_registry
from raptix.knowledge.ingest.materialize import apply_observations
from raptix_core.types.capability import Artifact
from raptix_core.types.kg import EdgeKind, KnowledgeGraph, NodeKind


class _NodeFixture(Protocol):
    kind: str
    data: dict[str, Any]


class _OutcomeFixture(Protocol):
    observations: list[_NodeFixture]
    summary: dict[str, Any]


class _RegistryFixture:
    def resolve(self, *args: Any, **kwargs: Any) -> Any:
        parser = _default_registry().resolve(*args, **kwargs)
        assert parser is not None
        return parser

    def parsers(self) -> Any:
        return _default_registry().parsers()

    def parse(self, artifact: Artifact, content: bytes) -> _OutcomeFixture:
        outcome = _default_registry().parse(artifact, content)
        for observation in outcome.observations:
            if observation.kind != "parse.summary":
                assert isinstance(observation.data.get("props"), dict)
                if "edges_out" in observation.data:
                    assert isinstance(observation.data["edges_out"], list)
        return cast(_OutcomeFixture, outcome)


def default_registry() -> _RegistryFixture:
    return _RegistryFixture()


def _artifact(content: bytes, hint: str | None = None, **metadata: JsonValue) -> Artifact:
    import hashlib

    digest = hashlib.sha256(content).hexdigest()
    return Artifact(
        id=f"test::{digest[:16]}",
        artifact_ref=f"sha256://{digest}",
        format_hint=hint,
        producer="test",
        metadata=metadata,
    )


def _node_observations(outcome: _OutcomeFixture) -> list[_NodeFixture]:
    return [obs for obs in outcome.observations if obs.kind != "parse.summary"]


class TestSqlmapLogParser:
    POSITIVE = (
        "sqlmap/1.8.2#stable\n"
        "[*] starting @ 14:32:01 /2026-10-07/\n"
        "[INFO] testing connection to the target URL\n"
        "[INFO] GET parameter 'id' is 'AND boolean-based blind - WHERE or HAVING clause' injectable\n"
        "sqlmap identified the following injection point(s) with a total of 58 HTTP(s) requests:\n"
        "---\n"
        "Parameter: id (GET)\n"
        "    Type: boolean-based blind\n"
        "    Title: AND boolean-based blind - WHERE or HAVING clause\n"
        "    Payload: id=1 AND 1234=1234\n"
        "---\n"
        "Parameter: id (GET)\n"
        "    Type: UNION query\n"
        "    Title: Generic UNION query (NULL) - 1 to 20 columns\n"
        "    Payload: id=-5731 UNION ALL SELECT NULL,NULL,NULL\n"
        "---\n"
        "[INFO] the back-end DBMS is MySQL\n"
        "back-end DBMS: MySQL >= 5.0 (MariaDB fork)\n"
        "[*] ending @ 14:33:12 /2026-10-07/\n"
    ).encode()

    def test_injection_blocks_become_vulnerabilities(self) -> None:
        outcome = default_registry().parse(
            _artifact(self.POSITIVE, "sqlmap_log", base_url="http://www.test.local/page.php"),
            self.POSITIVE,
        )
        vulns = [o for o in outcome.observations if o.kind == "Vulnerability"]
        assert len(vulns) == 2
        assert vulns[0].data["props"]["parameter"] == "id"
        assert vulns[0].data["props"]["technique"] == "boolean-based blind"
        assert vulns[0].data["props"]["payload"].startswith("id=1")
        assert vulns[0].data["props"]["evidence"] == "tool_reported"
        summary = outcome.summary
        assert summary["injection_points"] == 2
        assert summary["parameters"] == 1
        assert summary["dbms"] == "MySQL >= 5.0 (MariaDB fork)"

    def test_url_anchor_carries_has_vuln_and_runs_edges(self) -> None:
        outcome = default_registry().parse(
            _artifact(self.POSITIVE, "sqlmap_log", base_url="http://www.test.local/page.php"),
            self.POSITIVE,
        )
        graph = KnowledgeGraph()
        apply_observations(graph, outcome.observations)
        assert len(graph.by_kind(NodeKind.VULNERABILITY)) == 2
        assert len(graph.by_kind(NodeKind.TECHNOLOGY)) == 1
        url_node = graph.by_kind(NodeKind.URL)[0]
        edge_kinds = {edge.kind for edge, _ in graph.neighbors(url_node.id, direction="out")}
        assert edge_kinds == {EdgeKind.HAS_VULN, EdgeKind.RUNS}

    def test_unanchored_findings_do_not_invent_a_host(self) -> None:
        outcome = default_registry().parse(_artifact(self.POSITIVE, "sqlmap_log"), self.POSITIVE)
        kinds = {obs.kind for obs in _node_observations(outcome)}
        assert kinds == {"Vulnerability"}
        assert all(
            obs.data["props"].get("url_unknown") is True for obs in _node_observations(outcome)
        )

    def test_not_injectable_is_not_fabricated_success(self) -> None:
        content = (
            "sqlmap/1.8.2#stable\n"
            "[INFO] testing connection to the target URL\n"
            "[CRITICAL] all tested parameters do not appear to be injectable\n"
        ).encode()
        outcome = default_registry().parse(_artifact(content, "sqlmap_log"), content)
        assert _node_observations(outcome) == []
        assert outcome.summary["not_injectable"] is True
        assert outcome.summary["injection_points"] == 0

    def test_truncated_banner_yields_no_findings(self) -> None:
        content = b"sqlmap/1.8.2#stable\n[*] starting @ 14:32:01\n"
        outcome = default_registry().parse(_artifact(content, "sqlmap_log"), content)
        assert _node_observations(outcome) == []
        assert outcome.summary["injection_points"] == 0


class TestNiktoTxtParser:
    REPORT = (
        "- Nikto v2.5.0\n"
        "---------------------------------------------------------------------------\n"
        "+ Target IP:          10.10.10.5\n"
        "+ Target Hostname:    www.test.local\n"
        "+ Target Port:        80\n"
        "---------------------------------------------------------------------------\n"
        "+ Server: Apache/2.4.41 (Ubuntu)\n"
        "+ /admin/: Admin login page/section found.\n"
        "+ The X-Frame-Options header is not present.\n"
        "+ 7925 requests: 0 error(s) and 12 item(s) reported on remote host\n"
        "+ 1 host(s) tested\n"
    ).encode()

    def test_report_yields_host_findings_and_technology(self) -> None:
        outcome = default_registry().parse(_artifact(self.REPORT, "nikto_txt"), self.REPORT)
        misconfigs = [o for o in outcome.observations if o.kind == "Misconfiguration"]
        assert len(misconfigs) == 2
        assert misconfigs[0].data["props"]["target"] == "www.test.local"
        assert misconfigs[0].data["props"]["evidence"] == "tool_reported"
        host = outcome.observations[0]
        assert host.kind == "Host" and host.data["key"] == "host::www.test.local"
        assert host.data["props"]["port"] == 80
        host_edges = [dict(edge) for edge in host.data["edges_out"]]
        assert {
            "to_key": misconfigs[0].data["key"],
            "kind": "HAS_VULN",
            "weight": 0.6,
        } in host_edges
        assert {
            "to_key": "technology::server::Apache/2.4.41 (Ubuntu)",
            "kind": "RUNS",
            "weight": 0.6,
        } in host_edges
        assert outcome.summary["findings"] == 2
        assert outcome.summary["host"] == "www.test.local"

    def test_materializes_onto_graph(self) -> None:
        outcome = default_registry().parse(_artifact(self.REPORT, "nikto_txt"), self.REPORT)
        graph = KnowledgeGraph()
        apply_observations(graph, outcome.observations)
        assert len(graph.by_kind(NodeKind.MISCONFIGURATION)) == 2
        assert len(graph.by_kind(NodeKind.TECHNOLOGY)) == 1

    def test_truncated_header_yields_no_anchor_invention(self) -> None:
        content = b"- Nikto v2.5.0\n"
        outcome = default_registry().parse(_artifact(content, "nikto_txt"), content)
        assert _node_observations(outcome) == []
        assert outcome.summary["findings"] == 0
        assert outcome.summary["host"] == ""


class TestImpacketTxtParser:
    SECRETDUMP = (
        "[*] Service RemoteRegistry is in disabled state, starting it\n"
        "Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::\n"
        "CORP\\alice:1104:aad3b435b51404eeaad3b435b51404ee:c0ffee00c0ffee00c0ffee00c0ffee00:::\n"
        "CORP\\WIN-01$:1105:aad3b435b51404eeaad3b435b51404ee:deadbeefdeadbeefdeadbeefdeadbeef:::\n"
        "[+] Dumped 3 local account hashes\n"
    ).encode()

    LATERAL = (
        "[*] Requesting shares on 10.10.10.20.....\n"
        "[*] Found writable share ADMIN$\n"
        "[*] Uploading file kBfdxqXt.exe\n"
        "[*] Opening SVCManager on 10.10.10.20.....\n"
        "[*] Creating service kBdx on 10.10.10.20\n"
        "[*] Starting service kBdx....\n"
        "nt authority\\system\n"
        "[*] Cleaning up...\n"
    ).encode()

    def test_secretsdump_lines_become_credentials(self) -> None:
        outcome = default_registry().parse(
            _artifact(self.SECRETDUMP, "impacket_txt", target="10.10.10.20"), self.SECRETDUMP
        )
        creds = [o for o in outcome.observations if o.kind == "Credential"]
        assert len(creds) == 3
        alice = next(o for o in creds if o.data["props"]["account"] == "CORP\\alice")
        assert alice.data["props"]["secret_type"] == "ntlm"
        assert alice.data["props"]["hash"] == "c0ffee00c0ffee00c0ffee00c0ffee00"
        assert alice.data["props"]["rid"] == 1104
        assert alice.data["props"]["target"] == "10.10.10.20"
        users = {o.data["key"] for o in outcome.observations if o.kind == "User"}
        assert users == {"user::CORP\\alice"}
        assert outcome.summary["shape"] == "credential_extraction"
        assert outcome.summary["accounts_extracted"] == 3

    def test_lateral_output_becomes_session_evidence(self) -> None:
        outcome = default_registry().parse(
            _artifact(self.LATERAL, "impacket_txt", technique="psexec"), self.LATERAL
        )
        sessions = [o for o in outcome.observations if o.kind == "Session"]
        assert len(sessions) == 1
        assert sessions[0].data["props"]["target"] == "10.10.10.20"
        assert sessions[0].data["props"]["technique"] == "psexec"
        assert sessions[0].data["props"]["evidence"] == "remote_command_execution"
        assert sessions[0].data["props"]["command_output"] == ["nt authority\\system"]
        hosts = [o for o in outcome.observations if o.kind == "Host"]
        assert hosts and hosts[0].data["key"] == "host::10.10.10.20"
        assert outcome.summary["shape"] == "lateral_execution"

    def test_lateral_output_without_metadata_still_anchors_target(self) -> None:
        outcome = default_registry().parse(_artifact(self.LATERAL, "impacket_txt"), self.LATERAL)
        sessions = [o for o in outcome.observations if o.kind == "Session"]
        assert sessions[0].data["props"]["target"] == "10.10.10.20"

    def test_access_denied_is_not_fabricated_success(self) -> None:
        content = (
            "[*] Requesting shares on 10.10.10.20.....\n"
            "[*] Found writable share ADMIN$\n"
            "[-] SMB SessionError: STATUS_ACCESS_DENIED\n"
        ).encode()
        outcome = default_registry().parse(_artifact(content, "impacket_txt"), content)
        assert _node_observations(outcome) == []
        assert outcome.summary["shape"] == "failure"
        assert outcome.summary["failure_signals"][0].endswith("STATUS_ACCESS_DENIED")

    def test_sniffing_resolves_both_shapes(self) -> None:
        assert (
            default_registry().resolve(_artifact(self.SECRETDUMP), self.SECRETDUMP).format_id
            == "impacket_txt"
        )
        assert (
            default_registry().resolve(_artifact(self.LATERAL), self.LATERAL).format_id
            == "impacket_txt"
        )


class TestResponderLogParser:
    CAPTURE = (
        "[+] Listening for events...\n"
        "[SMB] NTLMv2-SSP Client   : 10.0.0.5\n"
        "[SMB] NTLMv2-SSP Hash     : johndoe::CORP:1122334455667788:cc36f0f1e88a9d0d1234567890abcdef:0101000000000000\n"
        "[HTTP] NTLMv1-SSP Client  : 10.0.0.6\n"
        "[HTTP] NTLMv1-SSP Hash    : jane::CORP:2233445566778899:0123456789abcdef0123456789abcdef:66667777\n"
        "[Analysis] LLMNR request for 'wpad' detected from 10.0.0.7\n"
    ).encode()

    def test_capture_pairs_become_credentials_and_hosts(self) -> None:
        outcome = default_registry().parse(_artifact(self.CAPTURE, "responder_log"), self.CAPTURE)
        creds = [o for o in outcome.observations if o.kind == "Credential"]
        assert len(creds) == 2
        johndoe = next(o for o in creds if str(o.data["props"]["hash"]).startswith("johndoe::"))
        assert johndoe.data["props"]["secret_type"] == "ntlmv2"
        assert johndoe.data["props"]["protocol"] == "SMB"
        assert johndoe.data["props"]["client"] == "10.0.0.5"
        assert johndoe.data["props"]["evidence"] == "captured_authentication"
        assert {o.data["key"] for o in outcome.observations if o.kind == "User"} == {
            "user::CORP\\johndoe",
            "user::CORP\\jane",
        }
        hosts = {o.data["key"] for o in outcome.observations if o.kind == "Host"}
        assert hosts == {"host::10.0.0.5", "host::10.0.0.6"}
        assert outcome.summary["captures"] == 2
        assert outcome.summary["analysis_lines"] == 1

    def test_poisoning_or_analysis_only_is_not_a_credential(self) -> None:
        content = (
            "[+] Poisoning LLMNR, MDNS, NBT-NS\n"
            "[Analysis] LLMNR request for 'wpad' detected from 10.0.0.7\n"
        ).encode()
        outcome = default_registry().parse(_artifact(content, "responder_log"), content)
        assert _node_observations(outcome) == []
        assert outcome.summary["captures"] == 0
        assert outcome.summary["poisoning_lines"] == 1

    def test_unpaired_client_line_yields_no_credential(self) -> None:
        content = b"[SMB] NTLMv2-SSP Client   : 10.0.0.5\n"
        outcome = default_registry().parse(_artifact(content, "responder_log"), content)
        assert _node_observations(outcome) == []
        assert outcome.summary["captures"] == 0


class TestJohnPotParser:
    POT = (
        "#$JOHNTIMESTAMP\n"
        "31d6cfe0d16ae931b73c59d7e0c089c0:\n"
        "aad3b435b51404eeaad3b435b51404ee:Summer2026!\n"
        "a1b2c3d4e5f60718293a4b5c6d7e8f90:Backup2026!\n"
    ).encode()

    def test_recovered_plaintext_becomes_credentials(self) -> None:
        outcome = default_registry().parse(_artifact(self.POT, "john_pot"), self.POT)
        creds = [o for o in outcome.observations if o.kind == "Credential"]
        assert len(creds) == 2
        first = creds[0].data["props"]
        assert first["secret_type"] == "recovered_plaintext"
        assert first["plaintext"] == "Summer2026!"
        assert first["ciphertext"].startswith("aad3b435")
        assert first["evidence"] == "offline_crack"
        assert creds[1].data["props"]["plaintext"] == "Backup2026!"
        assert outcome.summary["recovered"] == 2

    def test_format_metadata_is_stamped(self) -> None:
        outcome = default_registry().parse(_artifact(self.POT, "john_pot", format="nt"), self.POT)
        creds = [o for o in outcome.observations if o.kind == "Credential"]
        assert all(o.data["props"]["hash_format"] == "nt" for o in creds)

    def test_empty_plaintext_is_not_a_recovered_credential(self) -> None:
        # The NT-empty-hash pot entry (no plaintext) must not fabricate a
        # credential — only entries with recovered text count.
        outcome = default_registry().parse(
            _artifact(b"31d6cfe0d16ae931b73c59d7e0c089c0:\n", "john_pot"),
            b"31d6cfe0d16ae931b73c59d7e0c089c0:\n",
        )
        assert _node_observations(outcome) == []
        assert outcome.summary["recovered"] == 0

    def test_sniffed_generic_text_does_not_outrank_dedicated_parsers(self) -> None:
        # "key: value" shares the pot shape — john's sniffer must stay low
        # confidence so explicit resolution and dedicated sniffers win.
        parser = default_registry().resolve(
            _artifact(self.POT), self.POT, expected_formats=("john_pot",)
        )
        assert parser.format_id == "john_pot"


class TestSnmpwalkTxtParser:
    WALK = (
        '.1.3.6.1.2.1.1.1.0 = STRING: "Linux appliance 4.19.0-25-amd64"\n'
        ".1.3.6.1.2.1.1.3.0 = Timeticks: (1325400) 3:40:54.00\n"
        '.1.3.6.1.2.1.1.5.0 = STRING: "edge-router-01"\n'
        ".1.3.6.1.2.1.2.2.1.2.1 = STRING: eth0\n"
        ".1.3.6.1.2.1.2.2.1.2.2 = STRING: eth1\n"
    ).encode()

    def test_walk_becomes_host_evidence_anchored_to_target(self) -> None:
        outcome = default_registry().parse(
            _artifact(self.WALK, "snmpwalk_txt", target="10.0.0.254"), self.WALK
        )
        hosts = [o for o in outcome.observations if o.kind == "Host"]
        assert len(hosts) == 1
        props = hosts[0].data["props"]
        assert props["address"] == "10.0.0.254"
        assert props["source"] == "snmpwalk"
        assert props["snmp_system"][".1.3.6.1.2.1.1.5.0"] == "edge-router-01"
        assert props["snmp_interfaces"] == ["eth0", "eth1"]
        assert outcome.summary["oids_scanned"] == 5

    def test_timeout_failure_records_failure_signals_not_host(self) -> None:
        content = b"Timeout: No Response from 10.0.0.254.\n"
        outcome = default_registry().parse(
            _artifact(content, "snmpwalk_txt", target="10.0.0.254"), content
        )
        assert _node_observations(outcome) == []
        assert outcome.summary["failures"]
        assert "Timeout" in outcome.summary["failures"][0]


class TestPeasTxtParser:
    REPORT = (
        "LinPEAS v2026.10.06\n"
        "═══════════════════════════════════════\n"
        "╔══════════╣ System Information\n"
        "╔══════════╣ User Information\n"
        "uid=0(root) gid=0(root)\n"
        "├─[!] Vulnerable to CVE-2021-4034\n"
        "  CVE-2016-5195 mentioned in kernel changelog\n"
        "╚ https://book.hacktricks.wiki/\n"
    ).encode()

    def test_cve_markers_become_vulnerabilities(self) -> None:
        outcome = default_registry().parse(
            _artifact(self.REPORT, "peas_txt", target="10.0.0.30"), self.REPORT
        )
        vulns = [o for o in outcome.observations if o.kind == "Vulnerability"]
        assert [v.data["props"]["cve"] for v in vulns] == ["CVE-2021-4034", "CVE-2016-5195"]
        pwned = next(v for v in vulns if v.data["props"]["cve"] == "CVE-2021-4034")
        assert pwned.data["props"]["target_reported_vulnerable"] is True
        not_pwned = next(v for v in vulns if v.data["props"]["cve"] == "CVE-2016-5195")
        assert not_pwned.data["props"]["target_reported_vulnerable"] is False
        assert outcome.summary["vulnerable_to"] == ["CVE-2021-4034"]

    def test_section_titles_never_fabricate_host_evidence(self) -> None:
        outcome = default_registry().parse(_artifact(self.REPORT, "peas_txt"), self.REPORT)
        assert [o.kind for o in outcome.observations if o.kind != "parse.summary"] == [
            "Vulnerability",
            "Vulnerability",
        ]


class TestPspyLogParser:
    LOG = (
        "Config: printing commands (exit = empty process)\n"
        "Config: printing proclists with no commands\n"
        "CMD: UID=0     PID=1337   | /usr/sbin/cron -f\n"
        "CMD: UID=1000  PID=1420   | /usr/bin/backup.sh\n"
        "........................................................\n"
        "CMD: UID=0     PID=1901   | /usr/sbin/cron -f\n"
    ).encode()

    def test_root_commands_become_services(self) -> None:
        outcome = default_registry().parse(_artifact(self.LOG, "pspy_log"), self.LOG)
        services = [o for o in outcome.observations if o.kind == "Service"]
        assert len(services) == 1  # deduped: cron seen twice, backup.sh is non-root
        props = services[0].data["props"]
        assert props["uid"] == 0
        assert props["command"] == "/usr/sbin/cron -f"
        assert props["evidence"] == "observed_execution"
        assert outcome.summary["commands_seen"] == 3
        assert outcome.summary["root_commands_seen"] == 2

    def test_non_root_commands_stay_summary_only(self) -> None:
        content = b"CMD: UID=1000  PID=1420   | /usr/bin/backup.sh\n"
        outcome = default_registry().parse(_artifact(content, "pspy_log"), content)
        assert [o.kind for o in outcome.observations if o.kind != "parse.summary"] == []
        assert outcome.summary["root_unique_commands"] == 0


class TestSlitherJsonParser:
    REPORT = (
        '{"results": {"detectors": [{"check": "arbitrary-send", "impact": "High", '
        '"confidence": "Medium", "description": "Arbitrary send", '
        '"elements": [{"type": "function", "name": "withdraw", '
        '"source_mapping": {"filename_relative": "src/Target.sol"}}]}]}, '
        '"error": null}'
    ).encode()

    def test_detector_findings_become_vulnerabilities(self) -> None:
        outcome = default_registry().parse(_artifact(self.REPORT, "slither_json"), self.REPORT)
        vulns = [o for o in outcome.observations if o.kind == "Vulnerability"]
        assert len(vulns) == 1
        props = vulns[0].data["props"]
        assert props["check"] == "arbitrary-send"
        assert props["impact"] == "High"
        assert props["confidence"] == "Medium"
        assert props["evidence"] == "tool_reported"
        assert props["functions"] == ["withdraw"]
        assert props["files"] == ["src/Target.sol"]

    def test_compile_error_is_summary_not_finding(self) -> None:
        content = b'{"error": "CompilationError: solc not found", "success": false}'
        outcome = default_registry().parse(_artifact(content, "slither_json"), content)
        assert [o.kind for o in outcome.observations if o.kind != "parse.summary"] == []
        assert "solc not found" in outcome.summary["compile_error"]


class TestAdapterFormatResolution:
    def test_every_t7_expected_format_has_a_registered_parser(self) -> None:
        from raptix.execution.adapters.base import adapter_classes

        expected = {
            fmt for adapter_class in adapter_classes() for fmt in adapter_class.artifact_formats
        }
        registered = {p.format_id for p in default_registry().parsers()}
        assert expected <= registered

    @pytest.mark.parametrize(
        ("format_id", "content"),
        [
            ("sqlmap_log", TestSqlmapLogParser.POSITIVE),
            ("nikto_txt", TestNiktoTxtParser.REPORT),
            ("impacket_txt", TestImpacketTxtParser.SECRETDUMP),
            ("responder_log", TestResponderLogParser.CAPTURE),
            ("john_pot", TestJohnPotParser.POT),
            ("snmpwalk_txt", TestSnmpwalkTxtParser.WALK),
            ("peas_txt", TestPeasTxtParser.REPORT),
            ("pspy_log", TestPspyLogParser.LOG),
            ("slither_json", TestSlitherJsonParser.REPORT),
        ],
    )
    def test_new_formats_materialize_without_unknown_kinds(
        self, format_id: str, content: bytes
    ) -> None:
        outcome = default_registry().parse(_artifact(content, format_id), content)
        assert outcome.format_id == format_id
        graph = KnowledgeGraph()
        apply_observations(graph, outcome.observations)  # unknown kinds raise here
        known_kinds = {kind.value for kind in NodeKind}
        assert all(obs.kind in known_kinds for obs in _node_observations(outcome))
        known_edges = {kind.value for kind in EdgeKind}
        for obs in outcome.observations:
            for edge in obs.data.get("edges_out") or ():
                assert edge["kind"] in known_edges
