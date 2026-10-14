# 67-final-runtime: Contract the remaining runtime store dependencies

**Status:** runtime scope verified; parent 67 remains in-progress.
**Owner:** Final core contraction, branch `wi/67-final`, base `22cc7dd`.
**Contract:** ../execution.md; ADR-0067.

Sequential bounded leaves (parent 67 retains all outgoing completion blockers):

1. Provider extraction: `state/services.tsx`, `store.tsx`, demo runtime and navigation epoch; planned <350 runtime changed lines / <=5 files. Observed `1e53712`: 217 lines / 4 files. Canonical provider owns initialization, clock, ticker and log rebuild; test bridge forwards it.
2. Services imports: four batches of 10 files, planned <40 changed lines each. Observed `d54249e`, `803a8bf`, `2728b42`: 20 lines each; `e07c38b`: 21 lines. Runtime imports all resolve `state/services`.
3. Remaining helpers/types: canonical dirty hook, policy membership adapter and wizard draft contract. Observed `00960cc`: 46 lines / 9 files; `1052479`: 41 lines / 7 files. Dead analysis Store re-export removed; tests keep canonical forwards.
4. C2 consumer contraction: planned <400 changed runtime lines / <=10 files. Observed `1d3b59e`: 137 lines / 4 files (includes App composition). Session panels use typed reads; expiry notifications use a scoped synchronous feature projection. The mirrored failure audit remains explicit debt.
5. Regressions at the agreed rendered/service seams: failing-test commits precede Query notification, stale response, clock carryover and countdown reset fixes. Each fix is <=17 changed runtime lines / <=2 files. Existing teardown assertion preserved; clock lifecycle callback owns reset observation (`8842324`: 16 lines / 2 files).
6. Verification/evidence: actual typecheck, lint, full tests `--maxWorkers=2`, build and a temporary real-App StrictMode smoke probe. Exact residuals and observed exits are appended to parent 67. Cleanup-only `f494680`: 7 lines / 2 files.

Every code commit was inspected/measured before explicit-path staging. All work stayed on `wi/67-final`; no merge, branch switch or push. Test migration and generic `useDb` elimination remain follow-up work, not parent completion claims.
