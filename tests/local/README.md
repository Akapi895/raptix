# Local harnesses and test artifacts

Ad-hoc experiments and opt-in live gates live here. Regular package unit and
integration suites remain under `packages/*/tests`; web/Go test discovery is
unchanged. No benchmark target or live tool command runs merely by moving files.

```text
tests/local/
  harnesses/t2_probe.py                 Read a live T2 thread's summary
  harnesses/juice_shop_t2.py            Operator-managed Juice Shop T2 A/B runner
  manual/test_b0_session_isolation_live.py   Opt-in real sandbox tmux gate
  artifacts/workspaces/               Local generated workspaces, ignored by git
```

Run commands from the repository root (paths inside old experiment evidence
may still name the previous locations):

```powershell
uv run python tests/local/harnesses/juice_shop_t2.py --help
uv run python tests/local/harnesses/t2_probe.py <run-evidence-directory> <langgraph-url>

# Only after explicitly starting the isolated test stack:
$env:RAPTIX_B0_LIVE='1'
$env:SANDBOX_URL='<isolated sandbox endpoint>'
uv run pytest -s tests/local/manual/test_b0_session_isolation_live.py
```

The T2 runner's execution subcommands recreate its test containers and may
switch the LangGraph arm image. `--help` is a CLI parse check, not a live gate.
Historical ARMs/model settings and score semantics are preserved by relocation.

The manual B0 gate is explicitly addressed by path and marked `slow`/`manual`;
it is not in the package `testpaths` fast lane. Keep its evidence separate from
unit-test evidence. Store local outputs under `artifacts/`; never commit private
runtime state, credentials or workspace evidence merely to make the root tidy.

Root `tests/test_*.py` remain repository/Compose/CI contract tests. Current
default pytest `testpaths` includes the three package suites, not root contract
tests; run root contracts explicitly with
`uv run pytest tests -m "not slow and not manual"` when needed.
