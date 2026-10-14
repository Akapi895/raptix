# 67-test-migration: Final-interface regression harness

**Status:** in-progress; parent 67 retains its outgoing blockers.
**Owner:** `wi/67-tests`, base `b46ce97`; all existing tests, test helpers,
test-only fixtures and bounded deletion of `src/store.tsx`.
**Contract:** ../execution.md; ../spec.md; ADR-0067.

## Split leaves

- T1: canonical services/Query harness and read-only feature suites.
- T2: feature transaction integration/refetch suites, in batches of at most
  nine test files plus evidence.
- T3: safety, auth/router, shell and audit suites on final interfaces.
- T4: replace bridge-duality suites with observable integration, isolation,
  notification, reset and teardown assertions.
- T5: delete zero-caller Store sections in commits of at most 400 runtime
  changed lines and ten files; no relocated Store or compatibility action bag.
- T6: full typecheck/lint/test (`--maxWorkers=2`)/build, residual census and
  evidence. Parent completion awaits concurrent generic-read migration.

Each leaf may have multiple bounded commits. Tests do not count toward the
runtime-line budget; file caps still apply. Runtime screens/features/state
are owned by the concurrent worker and are outside this branch's edits.

## Baseline

- `npm install` in `apps/web-improve`: exit 0, 256 packages installed,
  audit reports zero vulnerabilities.
- `src/store.tsx`: 762 lines; runtime contraction evidence is in
  `67-final-runtime.md` and parent 67. Existing tests still import the bridge.
- Verification and exact final counts will be appended after execution.
