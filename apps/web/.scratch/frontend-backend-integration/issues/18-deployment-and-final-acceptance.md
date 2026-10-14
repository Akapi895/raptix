# 18: Verify deployment and close integration coverage

**What to build:** The canonical new UI is usable against the deployed API/runtime
with preserved data, working same-origin streaming and a durable acceptance
record for every required route and action.

**Blocked by:** 13 (fleet/fanout), 14 (library/analysis), 15 (overview/inbox),
16 (settings/audit), 17 (project closure).
**Status:** complete (named gaps recorded — see the ledger)
**Requirements:** R01-R12.
**Contract:** [execution.md](../execution.md).

These blockers transitively cover 01-12; do not add redundant dependency edges.

## Acceptance

- [x] Independent UI/server/container builds and required deployment wiring use
  canonical workspace paths. API errors never fall back to HTML; SSE is unbuffered
  and disconnects do not cancel a run. Existing volumes, IDs and bindings survive
  the cutover; database generation/migration is explicit.
  *(Builds/lint/typecheck green locally; proxy conf verified unbuffered with no
  API→HTML fallback; image defaults to real mode. The Docker real-mode smoke is
  restored in the CI `web-raptix` lane and adapted to the new console: hash
  route, real capabilities document, capability-unavailable state, no demo
  fallback, unconfigured API >= 400. It runs in CI — this environment has no
  Docker/Postgres; volume-persistence and `prisma migrate deploy` probes stay
  deployment-time checks. Named gap 1 in the ledger.)*
- [x] Retire remaining old frontend consumers only after their approved replacement
  or exclusion is recorded. Required campaigns/vault/member placement from 01 is
  complete; do not delete a unique real workflow without that decision.
  *(Legacy app replaced in 02; campaigns = recorded W17 exclusion with backend
  APIs retained; vault = ticket-16 detail tab; members = ticket 07.)*
- [x] Coverage accounts for all 53 keys, panels and route-less actions as verified
  real, explicit demo-only or requester-approved exclusion. Required unresolved
  functionality blocks full parity; the first real flow is not the full product.
  *(Ledger in coverage.md §8: 9 real pages + 5 real system pages + real project
  detail tabs; 39 keys render the honest not-integrated panel in real mode —
  recorded as unresolved, never certified.)*
- [ ] Exercise a bounded production E2E flow with persistence/recovery, a denial/
  outage and actual runtime output. Verify untested required route render/history/
  base-path cases and affected keyboard/theme/accessibility behavior; retain valid
  earlier evidence rather than rerunning every browser matrix.
  *(Unticked: requires a live deployed stack. The degraded-mode denial path is
  CI-certified by the restored smoke; persistence/recovery and actual runtime
  output remain fakes/stubs/recorded fixtures — named gaps 1-2. Earlier
  per-ticket a11y/theme/route evidence retained per the reuse rule.)*
- [ ] Measure all required cold authenticated JS/CSS, including required lazy
  chunks, and five interactive samples under declared network/CPU conditions.
  Record API latency and quiet-window TTI separately. Preserve budget targets or
  obtain an explicit change decision; no selective asset accounting.
  *(Unticked: not executable in this environment — named gap 3; budget targets
  preserved unchanged.)*
- [x] Publish reproducible harness commands and a durable acceptance ledger with
  tested tree, environments, affected-suite results, accepted exclusions/gaps and
  cleanup. Do not certify unexecuted real provider/runtime flows.
  *(coverage.md §8 + CI `web-raptix` lane; unexecuted live flows are listed as
  named gaps, never described as executed.)*

## Verification selection

First compare the final changes against the evidence ledger. Rerun only suites
whose code/contracts/dependencies changed, missing required checks, and the
bounded deployment/cross-system smoke above. Build final affected artifacts and
exercise their actual proxy/runtime path. A green CI lane may supplement evidence
but is not described as a locally executed test.

**No default full-suite command.** Do not select every test file as a disguised
full run or repeat all prior tests just because this is the last ticket. A
genuinely necessary broader/full run requires requester approval with the
reason and scope before execution.

## Scope boundary

This gate verifies delivered behavior; new required feature gaps return to their
owning ticket. It is not a catch-all implementation/refactor ticket or permission
to create extra ticket families without requester approval.
