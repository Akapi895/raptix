# 18: Verify deployment and close integration coverage

**What to build:** The canonical new UI is usable against the deployed API/runtime
with preserved data, working same-origin streaming and a durable acceptance
record for every required route and action.

**Blocked by:** 13 (fleet/fanout), 14 (library/analysis), 15 (overview/inbox),
16 (settings/audit), 17 (project closure).
**Status:** ready-for-agent
**Requirements:** R01-R12.
**Contract:** [execution.md](../execution.md).

These blockers transitively cover 01-12; do not add redundant dependency edges.

## Acceptance

- [ ] Independent UI/server/container builds and required deployment wiring use
  canonical workspace paths. API errors never fall back to HTML; SSE is unbuffered
  and disconnects do not cancel a run. Existing volumes, IDs and bindings survive
  the cutover; database generation/migration is explicit.
- [ ] Retire remaining old frontend consumers only after their approved replacement
  or exclusion is recorded. Required campaigns/vault/member placement from 01 is
  complete; do not delete a unique real workflow without that decision.
- [ ] Coverage accounts for all 53 keys, panels and route-less actions as verified
  real, explicit demo-only or requester-approved exclusion. Required unresolved
  functionality blocks full parity; the first real flow is not the full product.
- [ ] Exercise a bounded production E2E flow with persistence/recovery, a denial/
  outage and actual runtime output. Verify untested required route render/history/
  base-path cases and affected keyboard/theme/accessibility behavior; retain valid
  earlier evidence rather than rerunning every browser matrix.
- [ ] Measure all required cold authenticated JS/CSS, including required lazy
  chunks, and five interactive samples under declared network/CPU conditions.
  Record API latency and quiet-window TTI separately. Preserve budget targets or
  obtain an explicit change decision; no selective asset accounting.
- [ ] Publish reproducible harness commands and a durable acceptance ledger with
  tested tree, environments, affected-suite results, accepted exclusions/gaps and
  cleanup. Do not certify unexecuted real provider/runtime flows.

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
