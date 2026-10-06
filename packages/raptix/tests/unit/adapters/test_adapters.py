"""Deterministic tests for the Wave T7 adapter layer.

No LLM, no network, no real binaries: availability is injected, and
the only "execution" in the end-to-end test is a fake executor whose
canned nmap XML flows through the real T3 ``ParserRegistry`` into
observations.
"""

from __future__ import annotations

from typing import Any

import pytest

from raptix.execution.adapters import (
    AdapterParameterError,
    AdapterResolutionError,
    AdapterResolver,
    CommandAdapter,
    GobusterAdapter,
    ImpacketCredentialDumpAdapter,
    ImpacketLateralMoveAdapter,
    NiktoAdapter,
    NmapAdapter,
    ResponderAdapter,
    SqlmapAdapter,
    SubfinderAdapter,
    ToolAdapter,
    default_adapters,
)
from raptix.execution.adapters.base import artifact_name_param, str_list_param, str_param
from raptix.execution.capabilities import AvailabilityEvaluator, CapabilityRegistry
from raptix.execution.capabilities.registry import UnknownCapabilityError
from raptix.knowledge.ingest.registry import default_registry, iter_node_observations
from raptix_core.types.capability import (
    Artifact,
    CapabilityId,
    CapabilityManifest,
    CapabilityRequest,
    ExecutionRecord,
    ImplementationKind,
    ImplementationSpec,
)

T7_CAPABILITIES = (
    "network.scan",
    "network.discover_subdomains",
    "web.test_injection",
    "web.fuzz_paths",
    "web.scan_web",
    "access.move_laterally",
    "access.credential_dump",
    "network.capture_ntlm",
)


def _request(capability: str, **params: Any) -> CapabilityRequest:
    return CapabilityRequest(capability_id=CapabilityId(capability), parameters=params)


def _always_healthy(_executable: str) -> bool:
    return True


def _never_healthy(_executable: str) -> bool:
    return False


def _manifest(implementations: tuple[ImplementationSpec, ...], **kwargs: Any) -> CapabilityManifest:
    return CapabilityManifest(
        id=CapabilityId("test.cap"),
        schema_version=1,
        description="test capability",
        implementations=implementations,
        **kwargs,
    )


def _impl(impl_id: str, adapter_id: str, executable: str = "probe:attr") -> ImplementationSpec:
    return ImplementationSpec(
        id=impl_id,
        kind=ImplementationKind.ADAPTER,
        adapter_id=adapter_id,
        executable=executable,
    )


def _resolver(**kwargs: Any) -> AdapterResolver:
    availability = AvailabilityEvaluator(executable_probe=_always_healthy)
    registry = CapabilityRegistry(availability=availability)
    return AdapterResolver(registry, availability=availability, **kwargs)


class TestAdapterContract:
    def test_every_default_adapter_satisfies_the_protocol(self) -> None:
        adapters = default_adapters()
        assert set(adapters) == {
            "network.nmap",
            "network.subfinder",
            "web.sqlmap",
            "web.gobuster",
            "web.nikto",
            "ad.impacket.lateral",
            "ad.impacket.cred_dump",
            "ad.responder",
        }
        for adapter in adapters.values():
            assert isinstance(adapter, ToolAdapter)
            assert isinstance(adapter, CommandAdapter)
            assert adapter.capability_id and adapter.executable

    def test_adapter_ids_match_catalog_implementations(self) -> None:
        from raptix.execution.capabilities import build_catalog

        catalog_adapter_ids = {
            impl.adapter_id
            for manifest in build_catalog()
            for impl in manifest.implementations
            if impl.kind is ImplementationKind.ADAPTER and impl.profile == "base"
        }
        assert catalog_adapter_ids == set(default_adapters())

    def test_capability_ids_resolve_to_catalogued_capabilities(self) -> None:
        registry = CapabilityRegistry()
        for adapter in default_adapters().values():
            assert str(adapter.capability_id) in registry

    def test_is_available_probes_the_binary(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "raptix.execution.adapters.base.shutil.which", lambda _name: "/usr/bin/nmap"
        )
        assert NmapAdapter().is_available() is True
        monkeypatch.setattr("raptix.execution.adapters.base.shutil.which", lambda _name: None)
        assert NmapAdapter().is_available() is False


class TestParamValidation:
    def test_single_token_params_reject_whitespace(self) -> None:
        with pytest.raises(AdapterParameterError, match="whitespace"):
            NmapAdapter().build_argv(_request("network.scan", target="10.0.0.1 -iL /etc/passwd"))

    def test_params_reject_control_characters(self) -> None:
        with pytest.raises(AdapterParameterError, match="control"):
            SubfinderAdapter().build_argv(_request("network.discover_subdomains", domain="a\x00b"))

    def test_unknown_request_parameters_are_ignored(self) -> None:
        # No raw-args escape hatch: a planner cannot smuggle flags through
        # unrecognized parameters.
        baseline = NmapAdapter().build_argv(_request("network.scan", target="10.0.0.5"))
        smuggled = NmapAdapter().build_argv(
            _request(
                "network.scan",
                target="10.0.0.5",
                extra_args="-iL /etc/passwd --datadir /tmp",
                script="/does/not/exist",
            )
        )
        assert (
            baseline
            == smuggled
            == [
                "nmap",
                "-sT",
                "-sV",
                "-T3",
                "-oX",
                "nmap-scan.xml",
                "10.0.0.5",
            ]
        )

    def test_single_token_params_reject_leading_dash(self) -> None:
        """A bare positional value starting with '-' can be misread by the
        binary's own argument parser as a flag rather than a value —
        argument injection (no shell involved, distinct from command
        injection). Found by review; closed by rejecting it at the
        shared str_param validator every adapter builds on."""
        with pytest.raises(AdapterParameterError, match="must not start with '-'"):
            NmapAdapter().build_argv(_request("network.scan", target="--script=evil"))

    def test_str_list_param_entries_reject_leading_dash(self) -> None:
        with pytest.raises(AdapterParameterError, match="must not start with '-'"):
            str_list_param(_request("test.cap", items=["ok", "-flag"]), "items")

    def test_leading_dash_guard_has_explicit_opt_out(self) -> None:
        request = _request("test.cap", value="-not-smuggled")
        with pytest.raises(AdapterParameterError, match="must not start with '-'"):
            str_param(request, "value")
        assert str_param(request, "value", allow_leading_dash=True) == "-not-smuggled"

    def test_string_helpers(self) -> None:
        request = _request(
            "test.cap",
            token="plain-token",
            spaced="two words",
            empty="",
        )
        assert str_param(request, "token") == "plain-token"
        assert str_param(request, "spaced", allow_spaces=True) == "two words"
        assert str_param(request, "missing", default="fallback", required=False) == "fallback"
        with pytest.raises(AdapterParameterError, match="required"):
            str_param(request, "missing")
        with pytest.raises(AdapterParameterError, match="empty"):
            str_param(request, "empty")
        assert artifact_name_param(_request("test.cap"), "missing", default="out.txt") == "out.txt"
        with pytest.raises(AdapterParameterError, match="plain artifact filename"):
            artifact_name_param(_request("test.cap", path="../evil.xml"), "path", default="out.txt")


class TestNmapAdapter:
    def test_default_argv(self) -> None:
        argv = NmapAdapter().build_argv(_request("network.scan", target="10.0.0.0/24"))
        assert argv == ["nmap", "-sT", "-sV", "-T3", "-oX", "nmap-scan.xml", "10.0.0.0/24"]

    def test_syn_scan_with_ports(self) -> None:
        argv = NmapAdapter().build_argv(
            _request(
                "network.scan",
                target="10.0.0.5",
                scan_type="syn",
                ports="80,443",
                service_detection=False,
                no_ping=True,
                timing=4,
                output_path="out.xml",
            )
        )
        assert argv == ["nmap", "-sS", "-Pn", "-T4", "-p", "80,443", "-oX", "out.xml", "10.0.0.5"]

    def test_udp_scan(self) -> None:
        argv = NmapAdapter().build_argv(
            _request("network.scan", target="10.0.0.5", scan_type="udp")
        )
        assert argv[1] == "-sU"

    def test_rejects_bad_ports(self) -> None:
        with pytest.raises(AdapterParameterError, match="port list"):
            NmapAdapter().build_argv(_request("network.scan", target="t", ports="80;443"))

    def test_rejects_bad_scan_type_and_timing(self) -> None:
        with pytest.raises(AdapterParameterError, match="scan_type"):
            NmapAdapter().build_argv(_request("network.scan", target="t", scan_type="idle"))
        with pytest.raises(AdapterParameterError, match="timing"):
            NmapAdapter().build_argv(_request("network.scan", target="t", timing=9))


class TestSubfinderAdapter:
    def test_default_argv(self) -> None:
        argv = SubfinderAdapter().build_argv(
            _request("network.discover_subdomains", domain="corp.example")
        )
        assert argv == ["subfinder", "-d", "corp.example", "-json", "-o", "subfinder.jsonl"]

    def test_sources_joined(self) -> None:
        argv = SubfinderAdapter().build_argv(
            _request(
                "network.discover_subdomains",
                domain="corp.example",
                sources=["crtsh", "hackertarget"],
            )
        )
        assert "-sources" in argv and argv[argv.index("-sources") + 1] == "crtsh,hackertarget"

    def test_rejects_bad_domain(self) -> None:
        with pytest.raises(AdapterParameterError, match="domain"):
            SubfinderAdapter().build_argv(
                _request("network.discover_subdomains", domain="corp..example")
            )


class TestSqlmapAdapter:
    def test_default_argv(self) -> None:
        argv = SqlmapAdapter().build_argv(
            _request("web.test_injection", url="http://10.0.0.5/item.php?id=1")
        )
        assert argv == [
            "sqlmap",
            "-u",
            "http://10.0.0.5/item.php?id=1",
            "--batch",
            "--output-dir",
            "sqlmap",
            "--level=1",
            "--risk=1",
        ]

    def test_post_data_and_method(self) -> None:
        argv = SqlmapAdapter().build_argv(
            _request(
                "web.test_injection",
                url="https://10.0.0.5/login",
                data="user=a&pass=b",
                method="post",
                technique="BT",
                level=3,
                risk=2,
            )
        )
        assert "--data" in argv and argv[argv.index("--data") + 1] == "user=a&pass=b"
        assert "--method" in argv and argv[argv.index("--method") + 1] == "POST"
        assert "--technique" in argv and argv[argv.index("--technique") + 1] == "BT"
        assert "--level=3" in argv and "--risk=2" in argv

    def test_rejects_non_http_url(self) -> None:
        with pytest.raises(AdapterParameterError, match="http"):
            SqlmapAdapter().build_argv(_request("web.test_injection", url="ftp://10.0.0.5/x"))

    def test_rejects_bad_technique_and_bounds(self) -> None:
        with pytest.raises(AdapterParameterError, match="technique"):
            SqlmapAdapter().build_argv(
                _request("web.test_injection", url="http://t/x", technique="XZ")
            )
        with pytest.raises(AdapterParameterError, match="level"):
            SqlmapAdapter().build_argv(_request("web.test_injection", url="http://t/x", level=6))


class TestGobusterAdapter:
    def test_default_argv(self) -> None:
        argv = GobusterAdapter().build_argv(_request("web.fuzz_paths", url="http://10.0.0.5/"))
        assert argv == [
            "gobuster",
            "dir",
            "-u",
            "http://10.0.0.5/",
            "-w",
            "/usr/share/wordlists/dirb/common.txt",
            "-t",
            "10",
            "-o",
            "gobuster.txt",
            "-q",
        ]

    def test_extensions_and_threads(self) -> None:
        argv = GobusterAdapter().build_argv(
            _request(
                "web.fuzz_paths",
                url="http://10.0.0.5/",
                extensions=["php", "html"],
                threads=32,
                wordlist="/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt",
            )
        )
        assert argv[argv.index("-x") + 1] == "php,html"
        assert argv[argv.index("-t") + 1] == "32"

    def test_rejects_bad_extension(self) -> None:
        with pytest.raises(AdapterParameterError, match="extensions"):
            GobusterAdapter().build_argv(
                _request("web.fuzz_paths", url="http://t/", extensions=["ph;p"])
            )


class TestNiktoAdapter:
    def test_default_argv(self) -> None:
        argv = NiktoAdapter().build_argv(_request("web.scan_web", target="10.0.0.5"))
        assert argv == ["nikto", "-h", "10.0.0.5", "-o", "nikto.txt", "-Format", "txt"]

    def test_port_ssl_tuning(self) -> None:
        argv = NiktoAdapter().build_argv(
            _request("web.scan_web", target="10.0.0.5", port=8443, ssl=True, tuning="0123")
        )
        assert argv[:8] == ["nikto", "-h", "10.0.0.5", "-p", "8443", "-ssl", "-Tuning", "0123"]

    def test_rejects_bad_port(self) -> None:
        with pytest.raises(AdapterParameterError, match="port"):
            NiktoAdapter().build_argv(_request("web.scan_web", target="t", port=70000))


class TestImpacketAdapters:
    def test_lateral_move_full(self) -> None:
        argv = ImpacketLateralMoveAdapter().build_argv(
            _request(
                "access.move_laterally",
                target="10.0.0.5",
                username="jdoe",
                password="S3cret!",
                domain="CORP",
                technique="wmiexec",
                command="net user",
                hashes="aad3b435b51404ee:31d6cfe0d16ae931",
            )
        )
        assert argv == [
            "impacket-wmiexec",
            "CORP/jdoe:S3cret!@10.0.0.5",
            "net user",
            "-hashes",
            "aad3b435b51404ee:31d6cfe0d16ae931",
        ]

    def test_lateral_move_defaults(self) -> None:
        argv = ImpacketLateralMoveAdapter().build_argv(
            _request("access.move_laterally", target="10.0.0.5", username="jdoe", password="pw")
        )
        assert argv == ["impacket-psexec", "jdoe:pw@10.0.0.5", "whoami"]

    def test_lateral_move_password_may_contain_spaces(self) -> None:
        argv = ImpacketLateralMoveAdapter().build_argv(
            _request(
                "access.move_laterally",
                target="10.0.0.5",
                username="svc",
                password="a b c",
            )
        )
        assert argv[1] == "svc:a b c@10.0.0.5"

    def test_lateral_move_rejects_unknown_technique(self) -> None:
        with pytest.raises(AdapterParameterError, match="technique"):
            ImpacketLateralMoveAdapter().build_argv(
                _request(
                    "access.move_laterally",
                    target="10.0.0.5",
                    username="u",
                    password="p",
                    technique="netexec",
                )
            )

    def test_credential_dump(self) -> None:
        argv = ImpacketCredentialDumpAdapter().build_argv(
            _request(
                "access.credential_dump",
                target="10.0.0.5",
                username="admin",
                password="pw",
                domain="CORP",
            )
        )
        assert argv == [
            "impacket-secretsdump",
            "CORP/admin:pw@10.0.0.5",
            "-outputfile",
            "secretsdump",
        ]

    def test_credential_dump_requires_target_and_username(self) -> None:
        with pytest.raises(AdapterParameterError, match="target"):
            ImpacketCredentialDumpAdapter().build_argv(
                _request("access.credential_dump", username="admin", password="pw")
            )
        with pytest.raises(AdapterParameterError, match="username"):
            ImpacketCredentialDumpAdapter().build_argv(
                _request("access.credential_dump", target="10.0.0.5", password="pw")
            )


class TestResponderAdapter:
    def test_analyze_mode_by_default(self) -> None:
        argv = ResponderAdapter().build_argv(_request("network.capture_ntlm", interface="eth0"))
        assert argv == ["responder", "-I", "eth0", "-A"]

    def test_poison_mode_is_explicit(self) -> None:
        argv = ResponderAdapter().build_argv(
            _request("network.capture_ntlm", interface="eth0", poison=True)
        )
        assert argv == ["responder", "-I", "eth0", "-wrfPd"]

    def test_requires_interface(self) -> None:
        with pytest.raises(AdapterParameterError, match="interface"):
            ResponderAdapter().build_argv(_request("network.capture_ntlm"))


class TestAdapterResolver:
    def test_resolve_network_scan(self) -> None:
        spec = _resolver().resolve(_request("network.scan", target="10.0.0.0/24"))
        assert spec.implementation_id == "network.scan.nmap"
        assert spec.executor_id == "nmap"
        argv = spec.payload["argv"]
        assert isinstance(argv, list) and all(isinstance(item, str) for item in argv)
        assert spec.expected_artifact_formats == ("nmap_xml",)
        assert spec.timeout_seconds == 3600

    def test_every_t7_capability_resolves_to_its_binary(self) -> None:
        resolver = _resolver()
        expected = {
            "network.scan": ("nmap", {"target": "10.0.0.5"}),
            "network.discover_subdomains": ("subfinder", {"domain": "corp.example"}),
            "web.test_injection": ("sqlmap", {"url": "http://10.0.0.5/"}),
            "web.fuzz_paths": ("gobuster", {"url": "http://10.0.0.5/"}),
            "web.scan_web": ("nikto", {"target": "10.0.0.5"}),
            "access.move_laterally": (
                "impacket-psexec",
                {"target": "10.0.0.5", "username": "u", "password": "p"},
            ),
            "access.credential_dump": (
                "impacket-secretsdump",
                {"target": "10.0.0.5", "username": "u", "password": "p"},
            ),
            "network.capture_ntlm": ("responder", {"interface": "eth0"}),
        }
        for capability, (executable, params) in expected.items():
            spec = resolver.resolve(_request(capability, **params))
            assert spec.executor_id == executable, capability

    def test_picks_first_healthy_implementation_with_registered_adapter(self) -> None:
        manifest = _manifest(
            (
                _impl("known_adapter", "network.nmap"),
                _impl("unknown_adapter", "missing.adapter"),
            )
        )
        availability = AvailabilityEvaluator(executable_probe=_always_healthy)
        registry = CapabilityRegistry((manifest,), availability=availability)
        spec = AdapterResolver(registry, availability=availability).resolve(
            _request("test.cap", target="10.0.0.5")
        )
        assert spec.implementation_id == "known_adapter"

    def test_unknown_capability_propagates_registry_error(self) -> None:
        with pytest.raises(UnknownCapabilityError):
            _resolver().resolve(_request("network.nonexistent"))

    def test_unavailable_capability_is_never_resolved(self) -> None:
        manifest = _manifest((_impl("only", "network.nmap", executable="nmap"),))
        registry = CapabilityRegistry(
            (manifest,), availability=AvailabilityEvaluator(executable_probe=_never_healthy)
        )
        with pytest.raises(AdapterResolutionError, match="unavailable"):
            AdapterResolver(registry).resolve(_request("test.cap"))

    def test_healthy_implementation_without_adapter_is_a_hard_error(self) -> None:
        manifest = _manifest((_impl("unwired", "missing.adapter"),))
        availability = AvailabilityEvaluator(executable_probe=_always_healthy)
        registry = CapabilityRegistry((manifest,), availability=availability)
        with pytest.raises(AdapterResolutionError, match="no registered adapter"):
            AdapterResolver(registry, availability=availability).resolve(_request("test.cap"))

    def test_capability_without_implementations_is_unavailable(self) -> None:
        manifest = _manifest(())
        registry = CapabilityRegistry(
            (manifest,), availability=AvailabilityEvaluator(executable_probe=_always_healthy)
        )
        with pytest.raises(AdapterResolutionError, match="unavailable"):
            AdapterResolver(registry).resolve(_request("test.cap"))

    def test_snapshot_honesty_when_binaries_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # With no sandbox binaries on PATH (the common dev-host case) the
        # T7 capabilities report UNAVAILABLE — never a fake available.
        monkeypatch.setattr("raptix.execution.adapters.base.shutil.which", lambda _name: None)
        snapshot = CapabilityRegistry().health_snapshot()
        for capability in T7_CAPABILITIES:
            assert snapshot[capability]["status"] == "unavailable"
            assert snapshot[capability]["healthy_implementations"] == []

    def test_snapshot_reports_binary_present(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "raptix.execution.adapters.base.shutil.which",
            lambda name: "/usr/bin/" + name if name == "nmap" else None,
        )
        snapshot = CapabilityRegistry().health_snapshot()
        assert snapshot["network.scan"]["status"] == "available"
        assert snapshot["network.scan"]["healthy_implementations"] == ["network.scan.nmap"]


class TestNoBashFallback:
    def test_no_adapter_runs_or_names_bash(self) -> None:
        for adapter_id, adapter in default_adapters().items():
            assert "bash" not in adapter.executable.lower(), adapter_id
            assert "bash" not in adapter_id
            assert adapter.capability_id != "bash.execute"

    def test_resolver_never_fabricates_a_bash_spec(self) -> None:
        # Even for a capability the registry knows but nothing can run,
        # the resolver raises instead of inventing a bash implementation.
        registry = CapabilityRegistry(
            (_manifest(()),),
            availability=AvailabilityEvaluator(executable_probe=_always_healthy),
        )
        with pytest.raises(AdapterResolutionError):
            AdapterResolver(registry).resolve(_request("test.cap"))

    def test_bash_is_not_a_catalogued_capability(self) -> None:
        from raptix.execution.capabilities import build_catalog

        catalog_ids = {str(manifest.id) for manifest in build_catalog()}
        assert not any(capability.startswith("bash") for capability in catalog_ids)


class TestEndToEnd:
    NMAP_XML = b"""<?xml version="1.0"?>
<nmaprun scanner="nmap">
  <host>
    <status state="up"/>
    <address addr="10.0.0.5" addrtype="ipv4"/>
    <hostnames><hostname name="dc01.corp.local"/></hostnames>
    <ports>
      <port protocol="tcp" portid="445">
        <state state="open"/><service name="microsoft-ds" product="Samba" version="4.7"/>
      </port>
      <port protocol="tcp" portid="80">
        <state state="open"/><service name="http" product="nginx" version="1.18"/>
      </port>
    </ports>
  </host>
</nmaprun>
"""

    def test_request_to_observations(self) -> None:
        # 1. request → adapter → ExecutionSpec
        spec = _resolver().resolve(_request("network.scan", target="10.0.0.0/24"))
        # 2. fake sandbox executor runs the argv and stores the artifact
        artifact = Artifact(
            id="art-1",
            artifact_ref="artifact://run-1/art-1",
            format_hint=spec.expected_artifact_formats[0],
            producer=spec.executor_id,
        )
        record = ExecutionRecord(spec=spec, artifacts=(artifact,), success=True)
        assert record.success and record.spec is spec
        # 3. T3 ParserRegistry normalizes the artifact into observations
        outcome = default_registry().parse(
            artifact,
            self.NMAP_XML,
            expected_formats=spec.expected_artifact_formats,
        )
        assert outcome.format_id == "nmap_xml"
        kinds = {observation.kind for observation in iter_node_observations(outcome.observations)}
        assert {"Host", "Service", "Entrypoint"} <= kinds
        for observation in iter_node_observations(outcome.observations):
            assert observation.parser_id == "nmap_xml"
            assert observation.source_artifact_id == "art-1"

    def test_unparsable_expected_format_is_a_hard_error(self) -> None:
        # Adapter honesty: sqlmap has no registered parser yet (T8+); the
        # expected-format declaration must surface that as a parse error,
        # never a silent skip.
        spec = _resolver().resolve(_request("web.test_injection", url="http://10.0.0.5/"))
        artifact = Artifact(id="art-2", artifact_ref="artifact://run-1/art-2")
        from raptix.knowledge.ingest.registry import UnknownFormatError

        with pytest.raises(UnknownFormatError):
            default_registry().parse(
                artifact, b"sqlmap log text", expected_formats=spec.expected_artifact_formats
            )
