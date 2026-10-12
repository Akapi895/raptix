# Benchmarks

Evaluation tooling for Raptix, separate from the runtime package. The shared
challenge runner drives LangGraph agents; independent suites retain their own
lab lifecycle and scoring contracts.

## Structure

```text
benchmarks/
  runner.py, __main__.py    Shared CLI: python -m benchmarks.runner / benchmarks
  engine/                  Config, schemas, harness, scoring, reporting, provenance
  providers/               XBOW, ExploitBench, MHBench, Cybench, CyberGym, Buttercup
  suites/                  cve_bench/, dreadgoad/, tool_eval/
  configs/                 Executable configs grouped by suite
  docs/                    Operator guides, criteria, archived proposals
  scenarios/               Reusable inputs, including silentium/inputs/
  external/                Operator-managed upstream checkouts (ignored)
  results/
    runs/<suite>/<run-id>/  Generated attempts (ignored)
    published/<suite>/     Selected, versioned evidence
```

Root exports such as `from benchmarks import BenchmarkConfig` remain available.
Internal implementation imports use `benchmarks.engine.*` or
`benchmarks.suites.*`. The shared CLI remains `benchmarks.runner`.

## Shared challenge runner

Requires Docker/Compose, `uv`, a reachable LangGraph server, and the selected
provider's targets/tools. Use a dedicated benchmark stack with
`BENCHMARK_MODE=1`; the harness resets sandbox state between challenges.
Default LangGraph URL is `http://localhost:2024`; `BENCHMARK_LANGGRAPH_URL`
overrides it, otherwise `LANGGRAPH_PORT` selects the port.

```bash
uv run python -m benchmarks.runner --help
make benchmark ARGS="--level 1 --batch-size 5"
uv run python -m benchmarks --provider cybench --tags web
uv run python -m benchmarks.runner --provider exploitbench \
  --exploitbench-config benchmarks/configs/exploitbench/smoke.yaml
```

The shared CLI supports `xbow`, `exploitbench`, `mhbench`, `cybench` and
`cybergym`. Buttercup is available through its standalone provider API;
`configs/buttercup/smoke.yaml` is not a shared-CLI provider registration.
The proposed multi-domain config is archived in `docs/archive/`.

Each challenge follows:

```text
provider.load_challenges → provider.setup → harness invokes LangGraph
  → provider.evaluate → provider.teardown → scorer → reporter
```

Providers own target lifecycle and authoritative win conditions. The harness
owns dispatch, bounded cancellation, teardown ordering and provenance capture.
Reports retain unknown costs as unknown; a transcript claim alone is not a win.

## Independent suites

```bash
# CVE-Bench: deterministic offline smoke, no Docker or model calls
make cve-bench-dry

# DreadGOAD: provisioned AD lab, see the guide for AWS/lab prerequisites
uv run python -m benchmarks.suites.dreadgoad run \
  --config benchmarks/configs/dreadgoad/apt29.yaml --rounds 1

# Tool/capability evaluation: registry, selection-policy and executor tiers
uv run python -m benchmarks.suites.tool_eval --fixtures dev

# P3 evidence-context decision ablation (model provider, no target required)
uv run python -m benchmarks.suites.decision_eval --model custom/Qwen/Qwen3.5-122B-A10B-FP8
```

[Suite guides and evaluation criteria](docs/README.md) describe exact
prerequisites and scoring. Tool-eval's pinned baselines remain in
`suites/tool_eval/baseline/`; they are evaluator inputs, not disposable outputs.
Held-out corpora must not be used to tune tool schemas.

[Decision-eval guide](suites/decision_eval/README.md) documents P3 replay scenarios,
paired baseline/evidence conditions, held-out evaluation and reporting boundaries.

## Inputs and output policy

- `configs/<suite>/` contains usable config/spec files. `scenarios/<name>/`
  contains reusable engagement inputs, not run exports.
- `external/` contains downloaded upstream repos/data. Provider defaults and
  [setup instructions](external/README.md) point here; no external repository
  is cloned merely by importing or running `--help`.
- New outputs default to `results/runs/<suite>/<run-id>/`. Explicit output
  arguments remain available for operator-selected destinations.
- Publish selected evidence under `results/published/<suite>/`. Historical
  payloads/provenance are retained; embedded paths may describe the old layout.

A shared-runner attempt keeps its aggregate and challenges together:

```text
results/runs/xbow/run-<UTC>/
  report.json, report.md, index.json
  challenges/<challenge-id>/
    report.json, report.md
    evidence/summary.json, summary.md    # retained compatibility aliases
```

CVE-Bench writes `report.jsonl`; tool eval writes `report.json`. DreadGOAD keeps
its per-agent reports and grid state inside the enclosing run directory.
The [published index](results/README.md) links retained evidence and case studies.

## Verification

```bash
# Disable graph construction for offline unit tests, matching tool-eval's pinning.
RAPTIX_PLUGINS=__benchmark_tests__ uv run pytest -m "not slow" \
  packages/raptix/tests/unit/benchmark \
  tests/test_cve_bench_loader.py tests/test_cve_bench_scorer.py \
  tests/test_benchmark_layout.py
uv run ruff check benchmarks/ packages/raptix/tests/unit/benchmark/
uv run ruff format --check benchmarks/ packages/raptix/tests/unit/benchmark/
```

The `slow` harness tests exercise real timeout durations; live lab runs require
the corresponding suite's infrastructure and explicit operator configuration.
