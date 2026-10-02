"""Extract baseline metrics from existing benchmark results.

Step 0 of the control-plane fix sequence (ADR-0027). Reads
``benchmark/results/<challenge_id>/<UTC>/report.json`` files and emits
a structured baseline report covering the metrics that steps 1-5 of
the fix sequence will measure against.

Metrics extracted (per the review in ARCHITECTURE_AUDIT_FIX.md):

- ``task_dispatch_count`` — number of ``task()`` calls per run
- ``redispatch_count`` — same dispatch repeated
- ``no_info_call_count`` — repeated exact tool calls (e.g. the 204
  repeated ``ls`` calls from the audit's A1 evidence)
- ``kg_revision_transitions`` — KG revision changes (where trace data
  is available)
- ``objective_transitions`` — OPPLAN status changes
- ``invalid_contract_calls`` — skill-not-found, tool-not-in-slot
- ``if_to_np_transitions`` — IF→NP boundary crossings
- ``token_count`` — parent-only, with the P2-10 caveat

Metrics that are not present in ``report.json`` are marked
``"unavailable"`` rather than estimated. This is intentional — we
prefer honest gaps over fabricated numbers.

Usage::

    python scripts/baseline/extract_metrics.py \\
        --results-dir benchmark/results \\
        --output-dir benchmark/baselines/<UTC>

Output::

    benchmark/baselines/<UTC>/
        baseline.json    # structured metrics
        baseline.md      # human-readable summary
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RESULTS_DIR = REPO_ROOT / "benchmark" / "results"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "benchmark" / "baselines"

# Metrics that are always extracted (even if value is null).
METRIC_KEYS = [
    "task_dispatch_count",
    "redispatch_count",
    "no_info_call_count",
    "kg_revision_transitions",
    "objective_transitions",
    "invalid_contract_calls",
    "if_to_np_transitions",
    "token_count",
    "duration_seconds",
    "passed",
    "cancel_outcome",
    "terminal_status_at_teardown",
]


def _hash_file(path: Path) -> str:
    """SHA-256 of file contents, hex-encoded."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _hash_dir(root: Path) -> str:
    """SHA-256 of all files under root, sorted by path."""
    h = hashlib.sha256()
    for p in sorted(root.rglob("*")):
        if p.is_file():
            h.update(str(p.relative_to(root)).encode())
            h.update(p.read_bytes())
    return h.hexdigest()


def _extract_from_report(report: dict[str, Any]) -> dict[str, Any]:
    """Extract available metrics from a single report.json.

    Returns a dict with one entry per METRIC_KEYS. Values are either
    the extracted value or the string ``"unavailable"`` when the
    source data does not contain the metric.
    """
    out: dict[str, Any] = {}
    for key in METRIC_KEYS:
        if key in report and report[key] is not None:
            out[key] = report[key]
        else:
            out[key] = "unavailable"
    return out


def _scan_results(results_dir: Path) -> list[dict[str, Any]]:
    """Walk results_dir and extract metrics from every report.json."""
    runs: list[dict[str, Any]] = []
    if not results_dir.exists():
        return runs
    for report_path in sorted(results_dir.rglob("report.json")):
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"warning: skipping {report_path}: {exc}", file=sys.stderr)
            continue
        challenge_id = report.get("challenge_id", report_path.parent.parent.name)
        utc_dir = report_path.parent.name
        runs.append(
            {
                "challenge_id": challenge_id,
                "utc_timestamp": utc_dir,
                "report_path": str(report_path.relative_to(REPO_ROOT)),
                "metrics": _extract_from_report(report),
            }
        )
    return runs


def _aggregate(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute aggregate statistics across all runs."""
    total = len(runs)
    passed = sum(1 for r in runs if r["metrics"].get("passed") is True)
    failed = total - passed
    durations = [
        r["metrics"]["duration_seconds"]
        for r in runs
        if isinstance(r["metrics"].get("duration_seconds"), (int, float))
    ]
    tokens = [
        r["metrics"]["token_count"]
        for r in runs
        if isinstance(r["metrics"].get("token_count"), int)
    ]
    return {
        "total_runs": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": (passed / total) if total else 0.0,
        "duration_seconds": {
            "count": len(durations),
            "min": min(durations) if durations else None,
            "max": max(durations) if durations else None,
            "mean": (sum(durations) / len(durations)) if durations else None,
        },
        "token_count": {
            "count": len(tokens),
            "min": min(tokens) if tokens else None,
            "max": max(tokens) if tokens else None,
            "mean": (sum(tokens) / len(tokens)) if tokens else None,
            "note": "parent-only; P2-10 measurement debt applies",
        },
        "unavailable_metrics": {
            key: sum(1 for r in runs if r["metrics"].get(key) == "unavailable")
            for key in METRIC_KEYS
        },
    }


def _render_markdown(
    runs: list[dict[str, Any]],
    aggregate: dict[str, Any],
    benchmark_hash: str,
    results_dir: Path,
    captured_at: str,
) -> str:
    """Render a human-readable markdown summary."""
    lines: list[str] = []
    lines.append("# Baseline Report — Control-Plane Fix Sequence Step 0")
    lines.append("")
    lines.append(f"- **Captured at:** {captured_at}")
    lines.append(f"- **Results dir:** `{results_dir.relative_to(REPO_ROOT)}`")
    lines.append(f"- **Benchmark dir hash:** `{benchmark_hash}`")
    lines.append("- **Source:** ADR-0027")
    lines.append("")
    lines.append("## Aggregate")
    lines.append("")
    lines.append(f"- Total runs: **{aggregate['total_runs']}**")
    lines.append(f"- Passed: **{aggregate['passed']}**")
    lines.append(f"- Failed: **{aggregate['failed']}**")
    lines.append(f"- Pass rate: **{aggregate['pass_rate']:.1%}**")
    lines.append("")
    dur = aggregate["duration_seconds"]
    lines.append(
        f"- Duration (s): count={dur['count']}, "
        f"min={dur['min']}, max={dur['max']}, mean={dur['mean']}"
    )
    tok = aggregate["token_count"]
    lines.append(
        f"- Token count: count={tok['count']}, "
        f"min={tok['min']}, max={tok['max']}, mean={tok['mean']}"
    )
    lines.append(f"  - {tok['note']}")
    lines.append("")
    lines.append("## Unavailable metrics")
    lines.append("")
    lines.append("Metrics not present in `report.json` for any run:")
    lines.append("")
    lines.append("| Metric | Unavailable count |")
    lines.append("|---|---|")
    for key, count in aggregate["unavailable_metrics"].items():
        if count > 0:
            lines.append(f"| `{key}` | {count} / {aggregate['total_runs']} |")
    lines.append("")
    lines.append("## Per-run metrics")
    lines.append("")
    lines.append("| Challenge | UTC | Passed | Duration (s) | Tokens |")
    lines.append("|---|---|---|---|---|")
    for r in runs:
        m = r["metrics"]
        dur = m.get("duration_seconds", "unavailable")
        tok = m.get("token_count", "unavailable")
        passed = m.get("passed", "unavailable")
        lines.append(f"| {r['challenge_id']} | {r['utc_timestamp']} | {passed} | {dur} | {tok} |")
    lines.append("")
    lines.append("## Notes")
    lines.append("")
    lines.append(
        "- Metrics marked `unavailable` are not present in the source "
        "`report.json`. Steps 1-5 of the fix sequence may require "
        "additional instrumentation to make these metrics available."
    )
    lines.append(
        "- `token_count` is parent-only. P2-10 measurement debt means "
        "worker cost shifts can mask as parent-token reductions."
    )
    lines.append(
        "- This baseline is a snapshot. If the benchmark infrastructure "
        "changes, regenerate with `--force`."
    )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--results-dir",
        type=Path,
        default=DEFAULT_RESULTS_DIR,
        help="Directory containing benchmark results (default: benchmark/results)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory (default: benchmark/baselines/<UTC>)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing baseline directory",
    )
    args = parser.parse_args(argv)

    captured_at = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output_dir or (DEFAULT_OUTPUT_ROOT / captured_at)
    if output_dir.exists() and not args.force:
        print(
            f"error: {output_dir} already exists. Use --force to overwrite.",
            file=sys.stderr,
        )
        return 1
    output_dir.mkdir(parents=True, exist_ok=True)

    benchmark_dir = REPO_ROOT / "benchmark"
    benchmark_hash = _hash_dir(benchmark_dir) if benchmark_dir.exists() else "unavailable"

    runs = _scan_results(args.results_dir)
    aggregate = _aggregate(runs)

    baseline_json = {
        "schema_version": 1,
        "captured_at": captured_at,
        "results_dir": str(args.results_dir.relative_to(REPO_ROOT)),
        "benchmark_dir_sha256": benchmark_hash,
        "aggregate": aggregate,
        "runs": runs,
    }
    (output_dir / "baseline.json").write_text(
        json.dumps(baseline_json, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (output_dir / "baseline.md").write_text(
        _render_markdown(runs, aggregate, benchmark_hash, args.results_dir, captured_at),
        encoding="utf-8",
    )

    print(f"Baseline written to {output_dir.relative_to(REPO_ROOT)}")
    print(f"  Runs scanned: {aggregate['total_runs']}")
    print(f"  Passed: {aggregate['passed']} / {aggregate['total_runs']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
