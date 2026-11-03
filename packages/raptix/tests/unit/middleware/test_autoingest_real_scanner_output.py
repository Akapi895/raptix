"""Validate scanner auto-ingest against REAL tool output, not hand-written
minimal fixtures -- docs/design/2026-11-03-graph-technical-design.md Mục 9
roadmap step 1, required before any default-on decision for
``RAPTIX_KG_AUTOINGEST``/``RAPTIX_KG_TRIED_EDGES``.

Fixtures under ``tests/fixtures/real_scanner_output/`` were captured by
actually running each binary (see that directory's README for exact
commands, targets, and the one documented-format exception). Four things
per scanner, matching the roadmap's acceptance criteria:

  (a) the real binary's actual output is recognized and parses without error
  (b) the resulting observations carry the right kind/identity for what the
      binary really reported
  (c) re-ingesting the identical real output is idempotent -- the same
      content yields the same observation keys both times, which is the
      precondition ``KGStore``'s MERGE-by-key dedup relies on
  (d) a missing/empty/malformed output never raises and never writes
      anything -- confirmed with the real "arjun found nothing and wrote no
      file" case plus synthetic empty/malformed variants for the rest
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from raptix.knowledge.graph.ingest import (
    _adapt_arjun_json,
    _adapt_httpx_jsonl,
    _adapt_katana_jsonl,
    _adapt_nmap_xml,
    _adapt_nuclei_jsonl,
)
from raptix.knowledge.ingest import default_registry
from raptix.knowledge.ingest.registry import ParseError
from raptix.middleware.kg_autoingest import _output
from raptix_core.types.capability import Artifact

FIXTURES = Path(__file__).parents[2] / "fixtures" / "real_scanner_output"


class _StubStore:
    """Captures every ``record_observations`` payload; never writes anywhere real."""

    def __init__(self) -> None:
        self.calls: list[list[dict[str, Any]]] = []

    def record_observations(
        self,
        observations: list[dict[str, Any]],
        *,
        engagement: str,
        created_by: str,
        source_episode_id: str,
        provenance_channel: str = "legacy_unknown",
    ) -> dict[str, Any]:
        self.calls.append(list(observations))
        return {"created": len(observations), "merged": 0, "edges": 0}


def _keys(observations: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(o["kind"], o["key"]) for o in observations if "key" in o]


def _data_keys(observations: tuple[Any, ...]) -> list[tuple[str, str]]:
    """``(kind, key)`` pairs from registry-produced ``Observation``s, whose
    identity lives in ``.data["key"]`` (see knowledge/ingest/parsers/_shared.py)."""
    return [(o.kind, o.data["key"]) for o in observations if "key" in o.data]


# ── Legacy adapters (nmap/httpx/katana/nuclei/arjun) ──────────────────────


class TestLegacyAdaptersAgainstRealOutput:
    def test_nmap_real_capture_parses_and_is_idempotent(self) -> None:
        store = _StubStore()
        first = _adapt_nmap_xml(FIXTURES / "nmap.xml", store, "eng-1", "recon", "ep-1")  # type: ignore[arg-type]
        assert "error" not in first
        kinds = {o["kind"] for o in store.calls[0]}
        assert "Host" in kinds
        assert "Service" in kinds

        second = _adapt_nmap_xml(FIXTURES / "nmap.xml", store, "eng-1", "recon", "ep-2")  # type: ignore[arg-type]
        assert "error" not in second
        assert _keys(store.calls[0]) == _keys(store.calls[1])

    def test_httpx_real_capture_parses_and_is_idempotent(self) -> None:
        store = _StubStore()
        first = _adapt_httpx_jsonl(FIXTURES / "httpx.jsonl", store, "eng-1", "recon", "ep-1")  # type: ignore[arg-type]
        assert "error" not in first
        kinds = {o["kind"] for o in store.calls[0]}
        assert "Host" in kinds
        assert "Entrypoint" in kinds

        second = _adapt_httpx_jsonl(FIXTURES / "httpx.jsonl", store, "eng-1", "recon", "ep-2")  # type: ignore[arg-type]
        assert "error" not in second
        assert _keys(store.calls[0]) == _keys(store.calls[1])

    def test_katana_real_capture_parses_and_is_idempotent(self) -> None:
        store = _StubStore()
        first = _adapt_katana_jsonl(FIXTURES / "katana.jsonl", store, "eng-1", "recon", "ep-1")  # type: ignore[arg-type]
        assert "error" not in first
        kinds = {o["kind"] for o in store.calls[0]}
        assert "Endpoint" in kinds

        second = _adapt_katana_jsonl(FIXTURES / "katana.jsonl", store, "eng-1", "recon", "ep-2")  # type: ignore[arg-type]
        assert "error" not in second
        assert _keys(store.calls[0]) == _keys(store.calls[1])

    def test_nuclei_real_capture_parses_and_is_idempotent(self) -> None:
        store = _StubStore()
        first = _adapt_nuclei_jsonl(FIXTURES / "nuclei.jsonl", store, "eng-1", "recon", "ep-1")  # type: ignore[arg-type]
        assert "error" not in first
        kinds = {o["kind"] for o in store.calls[0]}
        assert "Vulnerability" in kinds

        second = _adapt_nuclei_jsonl(FIXTURES / "nuclei.jsonl", store, "eng-1", "recon", "ep-2")  # type: ignore[arg-type]
        assert "error" not in second
        assert _keys(store.calls[0]) == _keys(store.calls[1])

    def test_arjun_real_behavior_is_no_output_file_on_zero_params(self, tmp_path: Path) -> None:
        """Against the real local target, arjun found zero parameters and
        wrote no output file at all (see README) -- confirm the adapter
        reports a clean error, not a crash, for a path that was never
        created."""
        store = _StubStore()
        never_written = tmp_path / "arjun-would-be-output.json"
        out = _adapt_arjun_json(never_written, store, "eng-1", "recon", "ep-1")  # type: ignore[arg-type]
        assert "error" in out
        assert store.calls == []

    def test_nmap_adapter_errors_cleanly_on_empty_file(self, tmp_path: Path) -> None:
        # Empty bytes are not valid XML -- the one legacy format where "empty
        # file" is a parse error rather than "zero rows", unlike the JSONL ones.
        store = _StubStore()
        empty = tmp_path / "empty.xml"
        empty.write_bytes(b"")
        out = _adapt_nmap_xml(empty, store, "eng-1", "recon", "ep-1")  # type: ignore[arg-type]
        assert "error" in out
        assert store.calls == []

    @pytest.mark.parametrize(
        "adapter",
        [_adapt_httpx_jsonl, _adapt_katana_jsonl, _adapt_nuclei_jsonl],
    )
    def test_jsonl_adapter_writes_nothing_for_an_empty_file(
        self, adapter: Any, tmp_path: Path
    ) -> None:
        # Zero lines is not a parse error for JSONL -- just zero rows. The
        # guarantee that matters is no write happens, not that it errors.
        store = _StubStore()
        empty = tmp_path / "empty.jsonl"
        empty.write_bytes(b"")
        out = adapter(empty, store, "eng-1", "recon", "ep-1")
        assert "error" not in out
        assert store.calls == []

    @pytest.mark.parametrize(
        "adapter",
        [_adapt_httpx_jsonl, _adapt_katana_jsonl, _adapt_nuclei_jsonl],
    )
    def test_legacy_jsonl_adapter_skips_malformed_lines_without_crashing(
        self, adapter: Any, tmp_path: Path
    ) -> None:
        store = _StubStore()
        garbage = tmp_path / "garbage.jsonl"
        garbage.write_text("not json at all\n{broken\n", encoding="utf-8")
        out = adapter(garbage, store, "eng-1", "recon", "ep-1")
        assert "error" not in out


# ── Registry-based adapters (ffuf/gobuster/subfinder/dnsx/masscan) ────────


class TestRegistryParsersAgainstRealOutput:
    def _parse(self, kind: str, content: bytes, metadata: dict[str, Any] | None = None):
        artifact = Artifact(
            id="ep-1",
            artifact_ref=f"episode://ep-1/{kind}",
            format_hint=kind,
            producer="recon",
            metadata=metadata or {},
        )
        return default_registry().parse(artifact, content, expected_formats=(kind,))

    def test_ffuf_real_capture_parses_and_is_idempotent(self) -> None:
        content = (FIXTURES / "ffuf.json").read_bytes()
        first = self._parse("ffuf", content)
        kinds = {o.kind for o in first.observations}
        assert "URL" in kinds and "Entrypoint" in kinds
        second = self._parse("ffuf", content)
        assert _data_keys(first.observations) == _data_keys(second.observations)

    def test_gobuster_real_capture_parses_and_is_idempotent(self) -> None:
        content = (FIXTURES / "gobuster.txt").read_bytes()
        meta = {"base_url": "http://127.0.0.1:8999"}
        first = self._parse("gobuster", content, meta)
        kinds = {o.kind for o in first.observations}
        assert "URL" in kinds and "Entrypoint" in kinds
        second = self._parse("gobuster", content, meta)
        assert _data_keys(first.observations) == _data_keys(second.observations)

    def test_subfinder_real_capture_parses_and_is_idempotent(self) -> None:
        # Fixture is the first 30 of 22,249 real results (README) -- enough
        # to prove the real line format parses; the full-scale case (the
        # whole real output exceeds KGAutoIngestMiddleware's _MAX_BYTES and
        # must be dropped, not partially ingested) is covered at the
        # middleware level, not the parser, in test_surface_inventory_ingest.py.
        content = (FIXTURES / "subfinder.txt").read_bytes()
        first = self._parse("subfinder", content)
        assert first.observations
        assert all(o.kind in {"Host", "Entrypoint"} for o in first.observations)
        second = self._parse("subfinder", content)
        assert _data_keys(first.observations) == _data_keys(second.observations)

    def test_dnsx_real_capture_parses_and_is_idempotent(self) -> None:
        content = (FIXTURES / "dnsx.jsonl").read_bytes()
        first = self._parse("dnsx", content)
        kinds = {o.kind for o in first.observations}
        assert "Host" in kinds
        second = self._parse("dnsx", content)
        assert _data_keys(first.observations) == _data_keys(second.observations)

    def test_masscan_documented_format_parses(self) -> None:
        """masscan hung on this container's bridge network (README) -- this
        exercises its own documented -oJ shape, not a live capture."""
        content = (FIXTURES / "masscan.json").read_bytes()
        first = self._parse("masscan", content)
        kinds = {o.kind for o in first.observations}
        assert "Host" in kinds and "Service" in kinds

    @pytest.mark.parametrize("kind", ["ffuf", "masscan"])
    def test_json_registry_parser_rejects_empty_content(self, kind: str) -> None:
        with pytest.raises(ParseError):
            self._parse(kind, b"")

    def test_gobuster_without_matching_lines_yields_only_summary(self) -> None:
        result = self._parse("gobuster", b"no hits here\n", {"base_url": "http://127.0.0.1:8999"})
        assert result.observations == ()
        assert result.summary == {"urls_added": 0}


# ── Binary-name finding: Kali packages real httpx as httpx-toolkit ───────


class TestHttpxToolkitBinaryNameAlias:
    """README.md documents the real finding: on this sandbox image, the
    binary literally named ``httpx`` is the unrelated python-httpx pip CLI,
    not ProjectDiscovery's scanner -- which Kali packages as
    ``httpx-toolkit``. Every skill doc still tells the agent to type
    ``httpx``. ``_output()`` must recognize both spellings as the same
    scanner so auto-ingest actually fires on a real deployment of this
    image, not just in a synthetic test that assumes the agent always
    gets the binary name skill docs expect."""

    def test_httpx_toolkit_is_recognized_as_httpx(self) -> None:
        command = "httpx-toolkit -u http://10.0.0.5 -json -o /workspace/eng/httpx.jsonl"
        assert _output(command) == ("httpx_jsonl", "/workspace/eng/httpx.jsonl")

    def test_plain_httpx_still_recognized(self) -> None:
        command = "httpx -u http://10.0.0.5 -json -o /workspace/eng/httpx.jsonl"
        assert _output(command) == ("httpx_jsonl", "/workspace/eng/httpx.jsonl")

    def test_httpx_toolkit_without_json_flag_is_not_auto_ingested(self) -> None:
        # Same -json-flag requirement applies under either spelling.
        command = "httpx-toolkit -u http://10.0.0.5 -o /workspace/eng/httpx.txt"
        assert _output(command) is None
