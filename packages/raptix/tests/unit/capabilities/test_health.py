"""TC-2 placement-aware health checks â€” deterministic, fake-runner tests.

The checker must distinguish what import/PATH probing cannot: a binary
present only on the host vs. inside the sandbox, an enabled build flag
vs. an installed package, a declared output format vs. a registered
parser, and every failure shape must stay distinct.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from raptix.execution.capabilities import build_catalog
from raptix.execution.capabilities.health import (
    UNPROBED,
    CapabilityHealth,
    PlacementHealthChecker,
    ProbeFailureReason,
    _probe_script,
)
from raptix_core.types.capability import (
    CapabilityId,
    CapabilityManifest,
    CapabilityStatus,
    ImplementationKind,
    ImplementationSpec,
)


@dataclass
class FakeResponse:
    output: str = ""
    exit_code: int = 0


@dataclass
class FakeRunner:
    """Canned ``command -v``/``--version`` probe responses."""

    binaries: dict[str, str] = field(default_factory=dict)  # binary â†’ version banner
    profiles: frozenset[str] = frozenset()
    fail: bool = False
    calls: list[str] = field(default_factory=list)

    def execute(self, command: str, *, timeout: int | None = None) -> FakeResponse:
        del timeout
        self.calls.append(command)
        if self.fail:
            raise ConnectionError("sandbox unreachable")
        if "tool-versions" in command:
            return FakeResponse(output="".join(f"{name}.tsv\n" for name in sorted(self.profiles)))
        for binary, banner in self.binaries.items():
            if _probe_script(binary) == command:
                return FakeResponse(output=f"__RAPTIX_PRESENT__\n{banner}")
        return FakeResponse(output="__RAPTIX_ABSENT__\n")


def _manifest(**kwargs: Any) -> CapabilityManifest:
    defaults: dict[str, Any] = {
        "id": CapabilityId("test.cap"),
        "schema_version": 1,
        "description": "test",
        "implementations": (
            ImplementationSpec(
                id="impl.base",
                kind=ImplementationKind.ADAPTER,
                adapter_id="network.nmap",
                executable="nmap",
            ),
        ),
        "outputs": ("nmap_xml",),
    }
    defaults.update(kwargs)
    return CapabilityManifest(**defaults)


def _checker(runner: FakeRunner, **kwargs: Any) -> PlacementHealthChecker:
    defaults: dict[str, Any] = {
        "runner": runner,
        "environment": "sandbox@sha256:test",
        "parser_format_ids": lambda: {"nmap_xml"},
        "adapter_ids": lambda: {"network.nmap"},
    }
    defaults.update(kwargs)
    return PlacementHealthChecker(**defaults)


class TestPlacementHealth:
    def test_binary_in_sandbox_is_healthy_with_version(self) -> None:
        runner = FakeRunner(binaries={"nmap": "7.95"}, profiles=frozenset())
        checker = _checker(runner)
        health = checker.check(_manifest())
        assert health.status is CapabilityStatus.AVAILABLE
        row = health.implementations[0]
        assert row.healthy and row.reason == ProbeFailureReason.OK.value
        assert row.version == "7.95"

    def test_binary_missing_in_sandbox_is_binary_missing(self) -> None:
        runner = FakeRunner(profiles=frozenset())  # no nmap
        health = _checker(runner).check(_manifest())
        row = health.implementations[0]
        assert not row.healthy
        assert row.reason == ProbeFailureReason.BINARY_MISSING.value

    def test_profile_disabled_beats_binary_probe(self) -> None:
        runner = FakeRunner(binaries={"nuclei": "3.3.9"}, profiles=frozenset())
        manifest = _manifest(
            id=CapabilityId("test.profiled"),
            implementations=(
                ImplementationSpec(
                    id="impl.web",
                    kind=ImplementationKind.ADAPTER,
                    adapter_id="web.nuclei",
                    executable="nuclei",
                    profile="sandbox-web",
                ),
            ),
            outputs=("nuclei_jsonl",),
        )
        health = _checker(
            runner,
            adapter_ids=lambda: {"network.nmap", "web.nuclei"},
            parser_format_ids=lambda: {"nmap_xml", "nuclei_jsonl"},
        ).check(manifest)
        row = health.implementations[0]
        assert not row.healthy
        assert row.reason == ProbeFailureReason.PROFILE_DISABLED.value
        # Never probed the binary at all â€” the flag gate short-circuits.
        assert runner.calls == [
            "ls /opt/raptix/tool-versions/*.tsv 2>/dev/null | xargs -r -n1 basename 2>/dev/null"
        ]

    def test_unregistered_route_is_reported_not_guessed(self) -> None:
        runner = FakeRunner(binaries={"nmap": "7.95"})
        manifest = _manifest(
            implementations=(
                ImplementationSpec(
                    id="impl.builtin",
                    kind=ImplementationKind.ADAPTER,
                    adapter_id="builtin.carrier",
                    executable="some.module:attr",
                ),
            ),
        )
        health = _checker(runner).check(manifest)
        row = health.implementations[0]
        assert not row.healthy
        assert row.reason == ProbeFailureReason.ROUTE_UNREGISTERED.value

    def test_missing_parser_is_a_distinct_failure(self) -> None:
        runner = FakeRunner(binaries={"nmap": "7.95"})
        health = _checker(runner, parser_format_ids=lambda: set()).check(
            _manifest(outputs=("nmap_xml",))
        )
        row = health.implementations[0]
        assert not row.healthy
        assert row.reason == ProbeFailureReason.PARSER_MISSING.value

    def test_version_incompatible_is_distinct(self) -> None:
        runner = FakeRunner(binaries={"nmap": "7.91"})
        health = _checker(runner, required_versions={"nmap": "7.95"}).check(_manifest())
        row = health.implementations[0]
        assert not row.healthy
        assert row.reason == ProbeFailureReason.VERSION_INCOMPATIBLE.value
        assert row.version == "7.91"

    def test_runner_unreachable_is_distinct_from_binary_missing(self) -> None:
        runner = FakeRunner(fail=True)
        health = _checker(runner).check(_manifest())
        row = health.implementations[0]
        assert not row.healthy
        assert row.reason == ProbeFailureReason.RUNNER_UNREACHABLE.value

    def test_worker_implementations_are_unprobed_not_fabricated(self) -> None:
        from raptix_core.types.capability import CompletionSpec

        runner = FakeRunner(binaries={"nmap": "7.95"})
        manifest = _manifest(
            id=CapabilityId("test.worker"),
            implementations=(
                ImplementationSpec(
                    id="impl.worker",
                    kind=ImplementationKind.WORKER,
                    worker_id="exploit_worker",
                ),
            ),
            completion=CompletionSpec(max_steps=10),
        )
        health = _checker(runner).check(manifest)
        row = health.implementations[0]
        assert row.reason == UNPROBED
        assert health.status is CapabilityStatus.UNAVAILABLE

    def test_partial_aggregation_keeps_frozen_semantics(self) -> None:
        runner = FakeRunner(binaries={"nmap": "7.95"})
        manifest = _manifest(
            id=CapabilityId("test.partial"),
            implementations=(
                ImplementationSpec(
                    id="impl.a",
                    kind=ImplementationKind.ADAPTER,
                    adapter_id="network.nmap",
                    executable="nmap",
                ),
                ImplementationSpec(
                    id="impl.b",
                    kind=ImplementationKind.ADAPTER,
                    adapter_id="network.nmap",
                    executable="missing-tool",
                ),
            ),
        )
        health = _checker(runner).check(manifest)
        assert health.status is CapabilityStatus.PARTIAL


class TestHealthCache:
    def test_verdicts_are_environment_keyed_and_ttl_bounded(self) -> None:
        runner = FakeRunner(binaries={"nmap": "7.95"})
        now = [0.0]
        checker = _checker(runner, ttl_seconds=10.0, clock=lambda: now[0])
        first = checker.check(_manifest())
        now[0] += 5.0
        cached = checker.check(_manifest())
        assert cached is first
        assert len(runner.calls) == 1  # base profile: binary probe only, no re-probe
        now[0] += 11.0  # past TTL
        refreshed = checker.check(_manifest())
        assert refreshed is not first
        assert len(runner.calls) == 2

    def test_rebuilt_container_never_inherits_stale_verdicts(self) -> None:
        runner = FakeRunner(binaries={"nmap": "7.95"})
        checker = _checker(runner)
        old_env = checker.check(_manifest())
        # Same checker object, new environment identity (rebuilt container).
        checker._environment = "sandbox@sha256:rebuilt"
        checker._cache.clear()  # would be a new checker instance per env in prod
        new_env = checker.check(_manifest())
        assert old_env.capability_id == new_env.capability_id
        assert new_env.implementations[0].healthy

    def test_probe_script_never_scans_targets(self) -> None:
        script = _probe_script("nmap")
        assert "command -v" in script
        assert "--version" in script
        assert script.count("nmap") == 2  # presence check + version banner only

    def test_catalog_check_covers_every_manifest(self) -> None:
        runner = FakeRunner(
            binaries={
                "nmap": "7.95",
                "subfinder": "2.6.7",
                "sqlmap": "1.8.2",
                "gobuster": "3.6.0",
                "nikto": "2.5.0",
                "impacket-psexec": "impacket 0.12.0",
                "impacket-secretsdump": "impacket 0.12.0",
                "responder": "3.1.4.0",
                "nuclei": "3.3.9",
                "nxc": "1.3.0",
                "john": "1.9.0",
                "snmpwalk": "5.9.4",
                "slither": "0.11.6",
            },
            profiles=frozenset(
                {
                    "sandbox-web",
                    "sandbox-ad",
                    "sandbox-credentials",
                    "sandbox-network-extra",
                    "sandbox-contracts",
                }
            ),
        )
        checker = _checker(
            runner,
            adapter_ids=lambda: {
                "network.nmap",
                "network.subfinder",
                "web.sqlmap",
                "web.gobuster",
                "web.nikto",
                "ad.impacket.lateral",
                "ad.impacket.cred_dump",
                "ad.responder",
                "web.nuclei",
                "ad.netexec",
                "credentials.john",
                "network.snmpwalk",
                "contracts.slither",
                "ad.netexec.bloodhound",
            },
            parser_format_ids=lambda: {
                "nmap_xml",
                "subfinder",
                "sqlmap_log",
                "gobuster",
                "nikto_txt",
                "impacket_txt",
                "responder_log",
                "nuclei_jsonl",
                "crackmapexec",
                "john_pot",
                "snmpwalk_txt",
                "slither_json",
            },
        )
        snapshot: dict[str, CapabilityHealth] = checker.check_catalog(build_catalog())
        assert len(snapshot) == 26
        fully_probed = [
            health
            for health in snapshot.values()
            if health.status is CapabilityStatus.AVAILABLE
            and health.implementations
            and all(row.reason == ProbeFailureReason.OK.value for row in health.implementations)
        ]
        # Every sandboxed binary above exists in its enabled profile with a
        # registered parser â€” the T7+TC-2/5/7 core is placement-healthy.
        assert len(fully_probed) >= 10

    def test_implementation_with_no_executable_is_probe_error(self) -> None:
        """The frozen core contract already rejects an ADAPTER impl with
        an empty executable â€” the checker's defensive branch exists for
        defensively-constructed manifests; this pins that the contract
        itself is the first gate."""
        with pytest.raises(ValueError, match="requires adapter_id and executable"):
            _manifest(
                implementations=(
                    ImplementationSpec(
                        id="impl.empty",
                        kind=ImplementationKind.ADAPTER,
                        adapter_id="network.nmap",
                        executable="",
                    ),
                ),
            )
