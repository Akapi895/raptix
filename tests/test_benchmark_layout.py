"""Relocated benchmarks must resolve inputs and keep run evidence together."""

from __future__ import annotations

import importlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest


def test_shared_runner_retains_public_types_from_grouped_engine() -> None:
    import benchmarks

    config = importlib.import_module("benchmarks.engine.config")
    harness = importlib.import_module("benchmarks.engine.harness")
    runner = importlib.import_module("benchmarks.runner")

    assert benchmarks.BenchmarkConfig is config.BenchmarkConfig
    assert runner.Harness is harness.Harness


def test_cve_fixtures_resolve_outside_the_checkout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    loader = importlib.import_module("benchmarks.suites.cve_bench.loader")
    monkeypatch.chdir(tmp_path)

    challenges = loader.load_all(variants=("one_day",))

    assert {challenge.cve_id for challenge in challenges} == {
        "CVE-2023-37999",
        "CVE-2024-22120",
        "CVE-2024-2624",
    }


def test_report_index_keeps_challenge_evidence_inside_one_run(tmp_path: Path) -> None:
    from benchmarks import BenchmarkReport, ChallengeResult
    from benchmarks.engine.schemas import RunProvenance

    reporter_module = importlib.import_module("benchmarks.engine.reporter")
    now = datetime.now(timezone.utc)
    report = BenchmarkReport(
        provider_name="xbow",
        provenance=RunProvenance(
            run_id="fixture-run",
            captured_at=now,
            context_mode="hinted",
            source_commit="1" * 40,
            source_dirty=False,
            benchmark_revisions={},
            model_profile="test",
            model_assignments={"raptix": ["fixture-model"]},
            artifact_hashes={"fixture": "2" * 64},
            container_images={"fixture": "sha256:" + "3" * 64},
            config={"provider": "xbow"},
            python_version="3.13",
            platform="test",
        ),
        total=1,
        passed=1,
        failed=0,
        pass_rate=1.0,
        by_level={},
        by_tag={},
        results=[
            ChallengeResult(
                challenge_id="XBEN-001-24",
                challenge_name="fixture",
                level=1,
                tags=[],
                passed=True,
                duration_seconds=0.0,
            )
        ],
        started_at=now,
        completed_at=now,
        duration_seconds=0.0,
    )
    reporter = reporter_module.Reporter(tmp_path / "xbow")
    run_dir = reporter.write_evidence(report)
    aggregate = reporter.write_json(report)
    index = json.loads((run_dir / "index.json").read_text(encoding="utf-8"))
    evidence = Path(index["challenges"][0]["evidence_path"])

    assert aggregate.parent == run_dir
    assert evidence.is_relative_to(run_dir)
    assert json.loads(evidence.read_text(encoding="utf-8"))["passed"] is True
