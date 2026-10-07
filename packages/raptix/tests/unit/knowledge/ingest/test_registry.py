"""Deterministic dispatch, ambiguity rejection, and idempotence of the
Wave T3 ParserRegistry."""

from __future__ import annotations

import dataclasses

import pytest

from raptix.knowledge.ingest import (
    AmbiguousFormatError,
    ParseOutcome,
    ParserRegistry,
    UnknownFormatError,
    default_registry,
)
from raptix.knowledge.ingest.parsers import register_default_parsers
from raptix_core.types.capability import Artifact, Observation


def _artifact(content: bytes, hint: str | None = None) -> Artifact:
    import hashlib

    digest = hashlib.sha256(content).hexdigest()
    return Artifact(
        id=f"test::{digest[:16]}",
        artifact_ref=f"sha256://{digest}",
        format_hint=hint,
        producer="test",
    )


def _outcome(outcome: ParseOutcome) -> tuple:
    return tuple(dataclasses.asdict(obs) for obs in outcome.observations)


class _StaticParser:
    def __init__(self, format_id: str, score: float, versions: int = 1) -> None:
        self.format_id = format_id
        self.parser_version = f"1.0.{versions}"
        self._score = score
        self.parse_calls = 0

    def supports(self, artifact: Artifact, content: bytes) -> float:
        return self._score

    def parse(self, artifact: Artifact, content: bytes) -> list[Observation]:
        self.parse_calls += 1
        return [
            Observation(
                kind="Host",
                data={"key": f"host::{self.format_id}", "label": self.format_id},
            )
        ]


class TestBuiltinRegistration:
    def test_all_twenty_one_formats_registered(self) -> None:
        assert {p.format_id for p in default_registry().parsers()} == {
            "nmap_xml",
            "nuclei_jsonl",
            "httpx_jsonl",
            "katana_jsonl",
            "subfinder",
            "dnsx",
            "masscan",
            "ffuf",
            "gobuster",
            "testssl",
            "crackmapexec",
            "asrep_hashes",
            "sqlmap_log",
            "nikto_txt",
            "impacket_txt",
            "responder_log",
            "john_pot",
            "snmpwalk_txt",
            "slither_json",
            "peas_txt",
            "pspy_log",
        }

    def test_parsers_sorted_by_format_id(self) -> None:
        ids = [p.format_id for p in default_registry().parsers()]
        assert ids == sorted(ids)


class TestExplicitResolution:
    NMAP = b"<nmaprun><host><address addr='10.0.0.1' addrtype='ipv4'/></host></nmaprun>"

    def test_expected_format_resolves_exactly_one_parser(self) -> None:
        parser = default_registry().resolve(
            _artifact(self.NMAP), self.NMAP, expected_formats=("nmap_xml",)
        )
        assert parser.format_id == "nmap_xml"

    def test_format_hint_resolves(self) -> None:
        parser = default_registry().resolve(_artifact(self.NMAP, hint="nmap_xml"), self.NMAP)
        assert parser.format_id == "nmap_xml"

    def test_expected_format_without_parser_is_an_error_not_a_sniff(self) -> None:
        with pytest.raises(UnknownFormatError, match="no registered parser"):
            default_registry().resolve(_artifact(self.NMAP), self.NMAP, expected_formats=("sarif",))

    def test_expected_formats_skip_unregistered_ids_to_find_a_registered_one(self) -> None:
        """The first id WITH a registered parser wins â€” an earlier,
        unregistered candidate must not short-circuit the whole list."""
        parser = default_registry().resolve(
            _artifact(self.NMAP), self.NMAP, expected_formats=("sarif", "nmap_xml")
        )
        assert parser.format_id == "nmap_xml"

    def test_expected_formats_all_unregistered_raises_listing_every_candidate(self) -> None:
        with pytest.raises(UnknownFormatError, match="sarif.*slither|slither.*sarif"):
            default_registry().resolve(
                _artifact(self.NMAP), self.NMAP, expected_formats=("sarif", "slither")
            )


class TestSniffing:
    def test_ffuf_content_sniffs_without_hints(self) -> None:
        content = b'{"results": [{"url": "https://x.test/admin", "status": 200}]}'
        parser = default_registry().resolve(_artifact(content), content)
        assert parser.format_id == "ffuf"

    def test_asrep_content_sniffs(self) -> None:
        content = b"$krb5asrep$23$admin@CORP.LOCAL:abc$\n"
        parser = default_registry().resolve(_artifact(content), content)
        assert parser.format_id == "asrep_hashes"

    def test_recognized_content_without_any_parser_is_unknown(self) -> None:
        registry = ParserRegistry()
        with pytest.raises(UnknownFormatError):
            registry.resolve(_artifact(b"whatever"), b"whatever")


class TestAmbiguity:
    def test_tied_top_confidence_is_rejected_not_picked(self) -> None:
        registry = ParserRegistry()
        registry.register(_StaticParser("alpha", 0.8))
        registry.register(_StaticParser("beta", 0.8))
        with pytest.raises(AmbiguousFormatError) as excinfo:
            registry.resolve(_artifact(b"x"), b"x")
        assert excinfo.value.format_ids == ("alpha", "beta")

    def test_tie_rejection_independent_of_registration_order(self) -> None:
        for order in (("alpha", "beta"), ("beta", "alpha")):
            registry = ParserRegistry()
            for format_id in order:
                registry.register(_StaticParser(format_id, 0.8))
            with pytest.raises(AmbiguousFormatError):
                registry.resolve(_artifact(b"x"), b"x")

    def test_strictly_higher_confidence_wins(self) -> None:
        registry = ParserRegistry()
        loser = _StaticParser("alpha", 0.5)
        winner = _StaticParser("beta", 0.9)
        registry.register(loser)
        registry.register(winner)
        assert registry.resolve(_artifact(b"x"), b"x") is winner

    def test_zero_confidence_never_wins(self) -> None:
        registry = ParserRegistry()
        registry.register(_StaticParser("alpha", 0.0))
        with pytest.raises(UnknownFormatError):
            registry.resolve(_artifact(b"x"), b"x")


class TestProvenanceAndSummary:
    def test_observations_stamped_with_parser_and_artifact(self) -> None:
        content = b"<nmaprun><host><address addr='10.0.0.1' addrtype='ipv4'/></host></nmaprun>"
        artifact = _artifact(content)
        outcome = default_registry().parse(artifact, content, expected_formats=("nmap_xml",))
        assert outcome.format_id == "nmap_xml"
        assert outcome.summary["hosts"] == 1
        assert outcome.observations
        for obs in outcome.observations:
            assert obs.parser_id == "nmap_xml"
            assert obs.source_artifact_id == artifact.id

    def test_summary_observation_excluded_from_observations(self) -> None:
        content = b"<nmaprun></nmaprun>"
        outcome = default_registry().parse(
            _artifact(content), content, expected_formats=("nmap_xml",)
        )
        assert all(obs.kind != "parse.summary" for obs in outcome.observations)
        assert outcome.summary == {"hosts": 0, "services": 0, "entrypoints": 0}


class TestIdempotence:
    def test_same_content_and_metadata_produce_identical_observations(self) -> None:
        content = b"""<nmaprun><host><status state="up"/>
<address addr="10.0.0.9" addrtype="ipv4"/>
<hostnames><hostname name="h1.test"/></hostnames>
<ports><port portid="8080" protocol="tcp"><state state="open"/>
<service name="http" product="nginx" version="1.2"/></port></ports></host></nmaprun>"""
        registry = default_registry()
        first = registry.parse(
            _artifact(content, hint="nmap_xml"), content, expected_formats=("nmap_xml",)
        )
        second = registry.parse(
            _artifact(content, hint="nmap_xml"), content, expected_formats=("nmap_xml",)
        )
        assert _outcome(first) == _outcome(second)

    def test_registry_replays_are_free_of_clock_or_counter_drift(self) -> None:
        content = b"$krb5asrep$23$svc@CORP:x$\n"
        registry = ParserRegistry()
        parser = _StaticParser("asrep", 1.0)
        registry.register(parser)
        registry.parse(_artifact(content), content)
        registry.parse(_artifact(content), content)
        assert parser.parse_calls == 2


class TestArtifactReader:
    def test_content_comes_from_reader_never_from_artifact_ref(self) -> None:
        class _Reader:
            def __init__(self) -> None:
                self.read_refs: list[str] = []

            def read(self, artifact: Artifact) -> bytes:
                self.read_refs.append(artifact.artifact_ref)
                return b"$krb5asrep$23$svc@CORP:x$\n"

        reader = _Reader()
        outcome = default_registry().parse_artifact(_artifact(b"", hint="asrep_hashes"), reader)
        assert len(reader.read_refs) == 1
        assert reader.read_refs[0].startswith("sha256://")
        assert outcome.format_id == "asrep_hashes"
        assert outcome.summary["asrep_hashes_added"] == 1


def test_register_default_parsers_is_idempotent() -> None:
    registry = ParserRegistry()
    register_default_parsers(registry)
    register_default_parsers(registry)
    assert len(registry.parsers()) == 21
